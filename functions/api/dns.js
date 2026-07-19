// Cloudflare Pages Function: DNS 测量 (Globalping API)
// POST /api/dns  { domain } -> 提交三网 DNS 测量并轮询结果

const GLOBALPING_API = 'https://api.globalping.io/v1/measurements';
const PROBES_PER_CARRIER = 2;
const POLL_INTERVAL = 3000; // ms
const POLL_MAX_RETRIES = 10;

const CARRIERS = [
  { name: '电信', magic: 'china+AS4134' },
  { name: '联通', magic: 'china+AS4837' },
  { name: '移动', magic: 'china+AS9808' },
];

function cleanDomain(domain) {
  domain = domain.trim();
  for (const prefix of ['https://', 'http://']) {
    if (domain.startsWith(prefix)) domain = domain.slice(prefix.length);
  }
  const slashIdx = domain.indexOf('/');
  if (slashIdx !== -1) domain = domain.slice(0, slashIdx);
  const colonIdx = domain.indexOf(':');
  if (colonIdx !== -1) domain = domain.slice(0, colonIdx);
  return domain;
}

async function submitMeasurement(domain, carrier) {
  const body = {
    type: 'dns',
    target: domain,
    locations: [{ magic: carrier.magic, limit: PROBES_PER_CARRIER }],
    measurementOptions: {
      query: { type: 'A' },
      protocol: 'UDP',
      port: 53,
    },
  };

  const resp = await fetch(GLOBALPING_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'HuaDNS/1.0',
    },
    body: JSON.stringify(body),
  });

  if (![200, 201, 202].includes(resp.status)) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.id;
}

async function pollMeasurement(measurementId) {
  const url = `${GLOBALPING_API}/${measurementId}`;

  for (let i = 0; i < POLL_MAX_RETRIES; i++) {
    const resp = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'HuaDNS/1.0' },
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.status !== 'in-progress') {
        return data;
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error('轮询超时');
}

function extractDNSResult(carrierName, measurement) {
  if (!measurement || !measurement.results || measurement.results.length === 0) {
    return null;
  }

  const ipSet = new Set();
  const citySet = new Set();
  const ips = [];
  const cities = [];

  for (const probeRes of measurement.results) {
    const city = probeRes.probe?.city;
    if (city && !citySet.has(city)) {
      citySet.add(city);
      cities.push(city);
    }

    for (const ans of probeRes.result?.answers || []) {
      if (ans.type === 'A' && ans.value && !ipSet.has(ans.value)) {
        ipSet.add(ans.value);
        ips.push(ans.value);
      }
    }
  }

  if (ips.length === 0) return null;

  return { carrier: carrierName, cities, ips };
}

export async function onRequestPost({ request }) {
  try {
    const { domain: rawDomain } = await request.json();
    if (!rawDomain || !rawDomain.trim()) {
      return Response.json({ error: '未输入域名' }, { status: 400 });
    }

    const domain = cleanDomain(rawDomain);

    // 并发提交三网测量任务
    const submitResults = await Promise.allSettled(
      CARRIERS.map((c) => submitMeasurement(domain, c))
    );

    const measurementIds = {};
    const errors = [];

    submitResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        measurementIds[CARRIERS[idx].name] = result.value;
      } else {
        errors.push({ carrier: CARRIERS[idx].name, error: result.reason?.message });
      }
    });

    if (Object.keys(measurementIds).length === 0) {
      return Response.json(
        { error: '所有任务提交失败', details: errors },
        { status: 502 }
      );
    }

    // 并发轮询所有结果
    const pollResults = await Promise.allSettled(
      Object.entries(measurementIds).map(([name, id]) =>
        pollMeasurement(id).then((m) => ({ name, measurement: m }))
      )
    );

    const dnsResults = [];
    for (const result of pollResults) {
      if (result.status === 'fulfilled') {
        const { name, measurement } = result.value;
        const extracted = extractDNSResult(name, measurement);
        if (extracted) dnsResults.push(extracted);
      }
    }

    if (dnsResults.length === 0) {
      return Response.json({ error: '未获取到任何解析结果' }, { status: 504 });
    }

    // 汇总所有唯一 IP 及其来源运营商
    const ipCarriers = {};
    for (const res of dnsResults) {
      for (const ip of res.ips) {
        if (!ipCarriers[ip]) ipCarriers[ip] = [];
        ipCarriers[ip].push(res.carrier);
      }
    }

    const uniqueIPs = Object.keys(ipCarriers).sort();

    return Response.json({
      domain,
      dnsResults,
      uniqueIPs,
      ipCarriers,
      errors,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
