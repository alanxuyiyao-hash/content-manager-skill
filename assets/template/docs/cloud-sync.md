# 可选 Supabase 云同步

不配置环境变量时，应用直接使用本机 IndexedDB，无需注册、后端或云服务。云同步保留原有整包快照、逐记录合并、删除墓碑与版本比较逻辑。

## 初始化新项目

1. 在自己的 Supabase 账号创建新项目。在 SQL Editor 执行 `supabase/migrations/202611030001_app_state.sql`。迁移有意不使用 `create table if not exists`：如果已存在同名表，应先检查现有结构和策略，不覆盖已有部署。
2. 在 Authentication 中创建自己的邮箱密码用户。现有应用只提供登录，不提供注册、找回密码或邮箱管理界面；在 Supabase 控制台处理账号生命周期。
3. 将 `.env.example` 复制为 `.env.local`，填写自己项目的 `VITE_SUPABASE_URL` 与公开 anon/publishable key，重启开发服务器或重新构建。不要将 service_role、secret key 或数据库密码放入任何 `VITE_` 变量。
4. 云同步依赖的表为 `public.app_state`，每个用户只有一条记录：`user_id` UUID、`data` JSONB、`updated_at` text。`updated_at` 是前端生成并原样比较的 ISO 字符串，不可随意改为 timestamp 或自动触发器，否则会破坏比较和交换逻辑。

RLS 和授权按 [Supabase 官方说明](https://supabase.com/docs/guides/database/postgres/row-level-security)配置：未登录角色没有表权限，登录角色仅能查询、插入、更新自身行；项目删除通过快照内墓碑传播。SQL Editor 通常以管理员身份执行，不能用管理员查询成功证明 RLS 正确。可在测试项目运行 `supabase/tests/app_state_rls.sql`，它在事务内模拟两个用户与未登录角色，最后回滚。

## 使用与数据边界

- 首次登录前先导出本地 JSON 备份。本地记录可能与云端快照合并并上传。
- 这是个人工具：同一浏览器的 IndexedDB 不按 Supabase 账号划分。不要在同一浏览器配置文件中切换不同人的账号，多人使用请各自使用独立浏览器配置文件或设备。
- 云同步不等于无限备份。保留定期 JSON 导出；核对同步状态、网络与服务配额。
- 在新项目中先验证：用户 A 写入、第二设备以 A 登录可读；用户 B 看不到 A 的云端行；退出后匿名请求无法读取数据；离线编辑后恢复网络可以同步。
- 这些步骤需要用户自己的云项目与账号。模板本身不连接作者后端，不包含任何真实账号或数据。

## 静态部署

`npm run build` 生成 `dist/`，可部署到支持 SPA 回退的静态托管平台。HTTPS 用于生产 PWA；路由基于根路径。Cloudflare 可使用现有 `wrangler.jsonc`；先设置自己账户的项目名。环境变量在构建阶段注入，改动后必须重新构建。公开源码与部署的客户端都不应该包含管理密钥。
