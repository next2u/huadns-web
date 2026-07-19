// Cloudflare Pages Function: IP 归属地查询 (ip-api.com)
// POST /api/ipinfo  { ips: string[] } -> 批量查询 IP 归属地

const IP_API_URL = 'http://ip-api.com/json/%s?lang=zh-CN&fields=status,message,country,regionName,city,isp,org,as,query';
const IP_API_INTERVAL = 600; // ms, 免费版限速 45 req/min

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function queryIPInfo(ip) {
  const url = IP_API_URL.replace('%s', ip);

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'HuaDNS/1.0',
        Accept: 'application/json',
      },
    });

    const data = await resp.json();

    if (data.status === 'fail') {
      return { ip, error: data.message || '查询失败' };
    }

    return {
      ip: data.query || ip,
      country: data.country || '',
      region: data.regionName || '',
      city: data.city || '',
      isp: data.isp || '',
      org: data.org || '',
      as: data.as || '',
    };
  } catch (err) {
    return { ip, error: err.message };
  }
}

export async function onRequestPost({ request }) {
  try {
    const { ips } = await request.json();

    if (!ips || !Array.isArray(ips) || ips.length === 0) {
      return Response.json({ error: '未提供 IP 列表' }, { status: 400 });
    }

    // 限制单次最多查询 20 个
    const limitedIPs = ips.slice(0, 20);
    const results = {};

    for (let i = 0; i < limitedIPs.length; i++) {
      results[limitedIPs[i]] = await queryIPInfo(limitedIPs[i]);
      // 限速：非最后一个时等待
      if (i < limitedIPs.length - 1) {
        await sleep(IP_API_INTERVAL);
      }
    }

    return Response.json({ results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
