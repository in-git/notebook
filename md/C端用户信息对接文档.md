# 前端C端获取用户信息对接文档

## 一、接口 `/auth/c/getLoginUser` GET

入参：**无 body**，token 通过 **URL query 参数** 传递（本接口特有，区别于其他走请求头的接口）

```
GET {baseURL}/auth/c/getLoginUser?token=<token原串>
```

- token 取登录后保存的原串，**不带 `Bearer ` 前缀**
- 浏览器/后端可能在 URL 附加 `_=时间戳` 防缓存参数，前端可不传

返回结构（`code=200` 时 `data` 字段）

| 字段                 | 类型            | 说明                              |
| -------------------- | --------------- | --------------------------------- |
| id                   | string          | 用户ID                            |
| account              | string          | 账号                              |
| name                 | string          | 姓名                              |
| nickname             | string          | 昵称                              |
| avatar               | string          | 头像，图片base64                  |
| signature            | string          | 签名，图片base64                  |
| gender               | string          | 性别（字典值，配合GENDER字典）    |
| age                  | string          | 年龄                              |
| birthday             | string          | 出生日期                          |
| nation               | string          | 民族                              |
| nativePlace          | string          | 籍贯                              |
| homeAddress          | string          | 家庭住址                          |
| mailingAddress       | string          | 通信地址                          |
| idCardType           | string          | 证件类型                          |
| idCardNumber         | string          | 证件号码（SM4加密传输）           |
| cultureLevel         | string          | 文化程度                          |
| politicalOutlook     | string          | 政治面貌                          |
| college              | string          | 毕业院校                          |
| education            | string          | 学历                              |
| eduLength            | string          | 学制                              |
| degree               | string          | 学位                              |
| phone                | string          | 手机（SM4加密传输）               |
| email                | string          | 邮箱                              |
| homeTel              | string          | 家庭电话                          |
| officeTel            | string          | 办公电话                          |
| emergencyContact     | string          | 紧急联系人                        |
| emergencyPhone       | string          | 紧急联系人电话（SM4加密传输）     |
| emergencyAddress     | string          | 紧急联系人地址                    |
| lastLoginIp          | string          | 上次登录IP                        |
| lastLoginAddress     | string          | 上次登录地点                      |
| lastLoginTime        | string/datetime | 上次登录时间                      |
| lastLoginDevice      | string          | 上次登录设备                      |
| latestLoginIp        | string          | 最新登录IP                        |
| latestLoginAddress   | string          | 最新登录地点                      |
| latestLoginTime      | string/datetime | 最新登录时间                      |
| latestLoginDevice    | string          | 最新登录设备                      |
| userStatus           | string          | 用户状态（ENABLE/DISABLE）        |
| sortCode             | integer         | 排序码                            |
| extJson              | string          | 扩展信息                          |
| notePath             | string          | 备注文件路径（业务自定义字段）    |
| buttonCodeList       | array           | 按钮码集合                        |
| mobileButtonCodeList | array           | 移动端按钮码集合                  |
| permissionCodeList   | array           | **始终为空数组**（接口屏蔽）      |
| roleCodeList         | array           | 角色码集合                        |
| dataScopeList        | array           | **始终为空数组**（C端无数据范围） |
| password             | string          | 固定返回 `******`（已被后端屏蔽） |

## 二、后端取值逻辑（按顺序执行）

1. 从 `StpClientUtil` 的 `TokenSession` 缓存读取当前登录用户（`getClientLoginUser`）
2. 缓存为空（极端情况） → 查 `CLIENT_USER` 表，按 `id=StpClientUtil.getLoginIdAsString()` 取记录
3. 通过 JSON 深拷贝出一份返回对象
4. `password` 置为 `******`
5. `permissionCodeList`、`dataScopeList` 置为空数组
6. 返回

## 三、流程

### 1. 登录成功后回填用户信息

1. 保存登录返回的 token
2. 调用 `GET /auth/c/getLoginUser?token=xxx` 拉取用户信息
3. 保存用户信息（含 `id`，后续业务接口依赖此值）
4. 跳转主页（用 `replace`，禁止 `push`，防止回退到登录页）

### 2. 个人中心页渲染

1. 优先读已保存的用户信息，有则直接渲染
2. 无缓存或需刷新时再请求一次 `GET /auth/c/getLoginUser?token=xxx`
3. 登出后用户信息会被清掉

## 四、关键约束（硬性，必须遵守）

1. **必须登录后调用**，未登录会被 Sa-Token 拦截返回 401
2. **本接口 token 通过 URL query 参数传递**（`?token=xxx`），不走请求头；其他 C 端接口仍走请求头 `token`
3. `password` 字段永远是 `******`，**前端不要拿去做密码判断**
4. `permissionCodeList` / `dataScopeList` 永远为空，**不要依赖这两个字段做权限控制**（C端无数据范围概念）
5. `idCardNumber` / `phone` / `emergencyPhone` 在数据库是 **SM4 加密存储**，接口直接返回明文，前端展示直接用，不要二次解密
6. `userStatus === 'DISABLE'` 表示账号被停用，前端应在用户中心给提示
7. 缓存策略：接口内部走 `TokenSession` 缓存，**同一次会话内重复调用不会打 DB**
8. 接口路径前缀固定 `/auth/c/`，与登录/注册保持一致

## 五、关联接口

| 接口                     | 方法 | 用途                                |
| ------------------------ | ---- | ----------------------------------- |
| /auth/c/getLoginUser     | GET  | 获取当前C端登录用户信息（本文档）   |
| /auth/c/doLogout         | GET  | 退出登录，清空 token + 用户信息缓存 |
| /auth/c/isLogin          | GET  | 判断C端是否已登录，返回 boolean     |
| /sys/config/getByKey/... | GET  | 系统配置接口（按需）                |

## 六、典型时序

```
[登录成功]
   │
   ▼
保存 token
   │
   ▼
GET /auth/c/getLoginUser?token=xxx
   │
   ▼
返回 userInfo
   │
   ▼
保存用户信息（含 id）
   │
   ▼
跳转主页

---

[进入个人中心]
   │
   ▼
读已保存的用户信息
   ├─ 有 → 直接渲染
   └─ 无 → GET /auth/c/getLoginUser?token=xxx → 保存 → 渲染
```
