# C端文件上传对接精简文档（开发对接专用，剔除冗余描述，直接给开发/AI生成代码）

## 一、接口总览

| 接口                               | 方法 | 用途          | 鉴权      |
| ---------------------------------- | ---- | ------------- | --------- |
| `/client/c/fileFolder/upload`      | POST | C端单文件上传 | C端登录态 |
| `/client/c/fileFolder/uploadBatch` | POST | C端批量上传   | C端登录态 |

> 两个接口位于 `/client/c/**` 前缀下，系统 Sa-Token 拦截器自动走 C 端 `StpClientUtil` 校验，**不能**使用 B 端 token (`StpUtil`)。
> 任意已登录 C 端用户即可调用，**不需要**超管角色。

## 二、C端单文件上传 `/client/c/fileFolder/upload` POST

### 入参

| 参数 | 位置                | 必填 | 类型          | 说明                                    |
| ---- | ------------------- | ---- | ------------- | --------------------------------------- |
| file | request body (form) | 是   | MultipartFile | 表单字段名固定为 `file`，单个二进制文件 |

### 关键约束

- `Content-Type: multipart/form-data`
- 表单字段名**必须**叫 `file`（**不是** `files`）
- 单次只能传 1 个文件，**多文件请用 uploadBatch**
- 后端不限制文件大小，**由 Spring/Tomcat 配置决定**，前端要自己做大小校验提示
- 后端黑名单后缀（来自 `DevFileFolderExtBlackListEnum`）会直接拒绝，**不返回友好错误**，前端要预先校验

### 请求示例

```
POST /client/c/fileFolder/upload
Content-Type: multipart/form-data; boundary=----xxx
Authorization: Bearer <CLIENT_TOKEN>

------xxx
Content-Disposition: form-data; name="file"; filename="avatar.png"
Content-Type: image/png

<binary content>
------xxx--
```

### 返回

| 字段    | 类型   | 说明                   |
| ------- | ------ | ---------------------- |
| code    | int    | 200=成功               |
| data    | object | 上传结果 DTO（见下表） |
| message | string | 成功时为 `success`     |

`data` 字段

| 字段        | 类型   | 说明                                                                 |
| ----------- | ------ | -------------------------------------------------------------------- |
| id          | string | 雪花ID，写库主键                                                     |
| name        | string | 原始文件名                                                           |
| suffix      | string | 后缀（小写，不含点）                                                 |
| sizeKb      | long   | 文件大小 KB                                                          |
| sizeInfo    | string | 文件大小格式化（如 `1.2MB`）                                         |
| objName     | string | 存储对象名（uuid.ext）                                               |
| storagePath | string | 落盘相对路径（`client/yyyyMMdd/uuid.ext`）                           |
| url         | string | **公开访问 URL**（`http://host:port/file/client/yyyyMMdd/uuid.ext`） |
| contentType | string | MIME 类型                                                            |

成功响应

```json
{
  "code": 200,
  "data": {
    "id": "1900000000000000001",
    "name": "avatar.png",
    "suffix": "png",
    "sizeKb": 128,
    "sizeInfo": "128KB",
    "objName": "xxxxxxxx.png",
    "storagePath": "client/20260804/xxxxxxxx.png",
    "url": "http://localhost:82/file/client/20260804/xxxxxxxx.png",
    "contentType": "image/png"
  },
  "message": "success"
}
```

## 三、C端批量上传 `/client/c/fileFolder/uploadBatch` POST

### 入参

| 参数  | 位置                | 必填 | 类型            | 说明                                 |
| ----- | ------------------- | ---- | --------------- | ------------------------------------ |
| files | request body (form) | 是   | MultipartFile[] | 表单字段名固定为 `files`，多文件数组 |

### 关键约束

- `Content-Type: multipart/form-data`
- 表单字段名**必须**叫 `files`（**不是** `file`）
- 至少传 1 个文件，传 0 个后端会抛 `上传文件列表不能为空`
- 后端循环调用单文件上传逻辑，**任意一个文件失败整体失败**（事务由底层 DB 决定）
- 整体返回 `List`，**顺序与请求中文件顺序一致**

### 请求示例

```
POST /client/c/fileFolder/uploadBatch
Content-Type: multipart/form-data; boundary=----xxx
Authorization: Bearer <CLIENT_TOKEN>

------xxx
Content-Disposition: form-data; name="files"; filename="a.png"
Content-Type: image/png

<binary>
------xxx
Content-Disposition: form-data; name="files"; filename="b.jpg"
Content-Type: image/jpeg

<binary>
------xxx--
```

### 返回

成功响应（数组）

```json
{
  "code": 200,
  "data": [
    {
      "id": "1900000000000000001",
      "name": "a.png",
      "url": "http://localhost:82/file/client/20260804/xxx1.png",
      ...
    },
    {
      "id": "1900000000000000002",
      "name": "b.jpg",
      "url": "http://localhost:82/file/client/20260804/xxx2.jpg",
      ...
    }
  ],
  "message": "success"
}
```

## 四、文件访问方式（上传后如何给前端展示）

上传成功后会返回 `url` 字段，**前端直接用这个 URL**，不需要再调任何接口。

```
url = http://<host>:<port>/file/client/yyyyMMdd/uuid.ext
```

- `host:port` 是当前请求的 host:port（动态从 request 取，不写死）
- `/file/client/**` 已被配置为**免登录**静态资源路径（参考 `GlobalConfigure.addResourceHandlers`）
- `<img :src="url">`、`<a :href="url">` 即可直接访问，**不需要携带 token**

## 五、前端调用

```js
// 单文件
import { clientBaseRequest } from '@/utils/clientRequest';

const uploadSingle = async (file) => {
  const fd = new FormData();
  fd.append('file', file);
  const data = await clientBaseRequest(
    '/client/c/fileFolder/upload',
    fd,
    'post',
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return data; // { id, name, url, ... }
};

// 批量
const uploadBatch = async (fileList) => {
  const fd = new FormData();
  fileList.forEach((f) => fd.append('files', f));
  const data = await clientBaseRequest(
    '/client/c/fileFolder/uploadBatch',
    fd,
    'post',
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
  return data; // [{ id, name, url, ... }, ...]
};
```

> `clientBaseRequest` 自动从 localStorage 读 `CLIENT_TOKEN` 塞到 `Authorization` 头，**前端不要再手动塞 token**。

## 六、典型时序

### 6.1 单文件上传（头像场景）

```
[用户在 <input type="file"> 选择文件]
   │
   ▼
[前端校验] size / type(自己用 MIME 和后缀名过滤)
   │
   ▼
POST /client/c/fileFolder/upload
   body: multipart/form-data, field="file"
   │
   ├─ code=200 → 拿到 data.url → <img :src="data.url"> 展示
   │
   └─ code≠200 → message.error(后端返回的 message)
```

### 6.2 多文件上传（图片墙场景）

```
[用户多选 N 个文件]
   │
   ▼
[前端循环校验每个文件 size / type]
   │
   ▼
POST /client/c/fileFolder/uploadBatch
   body: multipart/form-data, field="files" × N
   │
   ├─ code=200 → 拿到 data[] 数组
   │     └─ 循环 data[i].url → 渲染图片列表
   │
   └─ code≠200 → message.error(整体失败,需要重传)
```

### 6.3 上传后展示

```
[data.url] → 直接作为 <img src> / <a href> / window.open(url)
         │
         └─ 浏览器 GET /file/client/yyyyMMdd/uuid.ext
               │
               └─ GlobalConfigure.addResourceHandlers 把 /file/client/** 映射到本地 uploadFolder/client/
                     │
                     └─ 静态返回二进制,无需任何 token
```

## 七、关键约束（硬性，必须遵守）

1. **C 端鉴权**：依赖 C 端 `CLIENT_TOKEN`（localStorage key=`CLIENT_TOKEN`），B 端 token `TOKEN` 调用会 401
2. **路径前缀**：必须 `/client/c/fileFolder/...`，**不要**写成 `/biz/fileFolder/...`（B 端路径会触发超管校验）
3. **表单字段名**：单文件用 `file`，批量用 `files`，**不能混淆**
4. **Content-Type**：必须是 `multipart/form-data`，**不能**是 `application/json`
5. **后端不限制大小**：由 Spring/Tomcat 配置决定，**前端必须自己做大小校验**
6. **后端黑名单后缀**：来自 `DevFileFolderExtBlackListEnum`，前端最好也加一个白名单预校验（图片：jpg/png/gif/webp；文档：pdf/docx/xlsx）
7. **url 字段免登录**：返回的 `url` 任何人可直接访问，**不要把敏感文件（如身份证照片）用这个接口**
8. **C 端用户绑定 ownerId**：文件 `ownerId` 字段会自动写入当前 C 端用户ID，**用于将来按用户查询/删除自己的文件**
9. **type 区分**：`type=CLIENT` 表示 C 端用户上传，**不要**与 `type=PUBLIC` 混用查询
10. **顺序一致性**：批量上传返回的数组顺序与请求中文件顺序一致，前端可以按索引对应

## 八、典型前端表单字段（参考）

| 字段         | 类型                                          | 说明                      |
| ------------ | --------------------------------------------- | ------------------------- |
| fileList     | File[]                                        | 用户已选择的文件原始对象  |
| uploading    | bool                                          | 上传中状态（禁用按钮）    |
| progress     | number                                        | 0~100 进度（前端自实现）  |
| uploadedList | DevFileFolderUploadResult[]                   | 上传成功后拼接的 url 列表 |
| editorState  | 'idle' \| 'uploading' \| 'success' \| 'error' | 上传状态机                |
