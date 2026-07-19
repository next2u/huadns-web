# HuaDNS Web

三网 DNS 解析检测（电信 / 联通 / 移动），基于 Globalping API，生成 Clash hosts 覆写配置。

## 功能

- 输入域名，并发检测三网 DNS 解析结果
- 查询 IP 归属地与运营商信息
- 选择 IP 一键生成 Clash 覆写配置并复制

## 部署

[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/next2u/huadns-web)

或手动：Cloudflare Dashboard → Pages → 连接本仓库 → 输出目录填 `public`，构建命令留空。

## 技术栈

- Cloudflare Pages Functions (服务端 API 代理)
- 原生 HTML/CSS/JS (零依赖前端)
