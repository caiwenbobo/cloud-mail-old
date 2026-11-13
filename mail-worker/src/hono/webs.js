import app from './hono';
import '../security/security'

import '../api/email-api';
import '../api/user-api';
import '../api/login-api';
import '../api/setting-api';
import '../api/account-api';
// ===== PATCH：新增（有效期补丁）——不 import 的话 expiry-api.js 里的路由不会注册 =====
import '../api/expiry-api';
import '../api/star-api';
import '../api/test-api';
import '../api/r2-api';
import '../api/resend-api';
import '../api/user-api';
import '../api/my-api';
import '../api/role-api'
import '../api/all-email-api'
import '../api/init-api'
import '../api/analysis-api'
import '../api/reg-key-api'
import '../api/public-api'
import '../api/telegram-api'
import '../api/oauth-api'
export default app;
