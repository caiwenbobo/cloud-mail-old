import app from '../hono/hono';
import expiryService from '../service/expiry-service';
import result from '../model/result';
import userContext from '../security/user-context';

// PATCH（新增文件）：邮箱有效期接口。
// 鉴权：和 /account/setName、/account/setAllReceive、/account/setAsTop 一样，
// 这两个路由不进 security.js 的 requirePerms（只靠 JWT + service 层按账号归属校验）。
// 原因是 requirePerms 里的路由还要再过一层角色权限表 premKey；新加权限 key 需要给
// 所有现有角色补权限，否则普通用户会被 403 拦住——而 setName 这些同类接口就是
// JWT-only + service 层校验归属的先例。跨用户读写在 service 层已被堵死：
// GET 只返回 userId === 调用者的记录；POST 先查账号归属再写。

app.get('/account/expiry', async (c) => {
	const list = await expiryService.getMyExpiries(c, userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.post('/account/expiry', async (c) => {
	const rec = await expiryService.setExpiry(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(rec));
});
