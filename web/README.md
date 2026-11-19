# vm2api 管理台

Vite + React。开发：

```bash
VM2API_API_PROXY=http://127.0.0.1:8787 pnpm dev
```

路由是 hash：`#/overview`、`#/database`、`#/users`、`#/settings/backup`。构建：`pnpm build` → `web/dist`，控制面 `GET /console` 提供。

CRAG 授权管理位于 `#/crag-subscription`；管理员可查看本机授权、刷新状态、兑换已有使用券。单槽授权状态、有效期和导入仍在虚拟机或内核的授权面板中。控制台不再提供购买入口。冒烟检查：登录页无购买链接；直接打开 `#/crag-purchase` 和 `#/crag-preview` 均不显示店铺；打开授权管理并刷新时，浏览器网络面板无 `crag-shop` 请求。
