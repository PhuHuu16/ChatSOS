# ChatSOS

Ứng dụng nhắn tin web: chat riêng, nhóm, gửi ảnh và tệp, nhận tin tức thì.
Frontend React chạy hoàn toàn trên trình duyệt; dữ liệu, đăng nhập, lưu tệp và
realtime dùng [Supabase](https://supabase.com). Giao diện tiếng Việt và tiếng Anh.

## Tính năng

- Đăng ký, đăng nhập bằng email và mật khẩu (hỗ trợ cả khi bật xác nhận email).
- Tìm người dùng theo tên để chat riêng; tạo nhóm có tên và thành viên.
- Gửi tin văn bản ngay lập tức trên giao diện; mất mạng thì báo lỗi, bấm "Thử lại"
  là gửi tiếp mà không bao giờ bị trùng tin.
- Gửi ảnh (JPG, PNG, WebP, GIF) và tệp (PDF, TXT, ZIP, DOCX, XLSX, PPTX), tối đa
  20 MB: bằng nút 📎, dán (Ctrl+V) hoặc kéo thả. Ảnh xem ngay trong chat, tệp tải về
  giữ đúng tên gốc.
- Sửa tin văn bản và thu hồi tin (cả ảnh/tệp) trong 2 phút sau khi gửi; người kia thấy
  ngay. Tin thu hồi bị xoá nội dung trên server, ảnh/tệp bị xoá khỏi Storage.
- Nhận tin mới tức thì (Supabase Realtime); mất kết nối thì báo và tự đồng bộ lại.
- "Đang nhập…" khi người kia gõ, và "Đã gửi / Đã xem" dưới tin cuối của mình (nhóm hiện tên
  người đã xem). Chat và nhóm mới hiện ngay với người được thêm vào.
- Hồ sơ cá nhân: đổi tên hiển thị và ảnh đại diện (ảnh được cắt vuông 256×256, bỏ
  thông tin EXIF/GPS ngay trên trình duyệt). Ảnh hiện ở thanh bên, danh sách chat,
  đầu khung chat riêng và kết quả tìm người; không có ảnh thì hiện chữ cái đầu.
  Tên người dùng (`@username`) không đổi được.
- Đếm tin chưa đọc; mở chat thì nhảy tới tin chưa đọc đầu tiên.
- Xem 50 tin mới nhất, cuộn lên đầu để tải thêm tin cũ.
- Lỗi bất ngờ hiện màn hình báo lỗi có nút tải lại, thay vì trang trắng.

## Công nghệ

React 19, TypeScript, Vite, Tailwind CSS v4, i18next, supabase-js
(Postgres + Row Level Security, Auth, Storage, Realtime).

## Yêu cầu

- Node.js 22 trở lên (đã dùng Node 24).
- Một dự án Supabase.

> Trên Windows PowerShell, nếu `npm` bị chặn bởi execution policy, dùng `npm.cmd`
> (ví dụ `npm.cmd install`).

## Cài đặt

### 1. Database Supabase

Mở **Supabase Dashboard → SQL Editor** và chạy lần lượt 8 file trong
`supabase/migrations/`, mỗi lần một file, theo đúng thứ tự tên file:

1. `20261016000100_profiles.sql`: hồ sơ người dùng.
2. `20261016000200_conversations.sql`: cuộc trò chuyện, thành viên, tin nhắn và RLS.
3. `20261016000300_rpc.sql`: hàm tạo chat riêng và nhóm.
4. `20261016000400_message_triggers.sql`: kiểm tra tin nhắn và tệp đính kèm.
5. `20261016000500_storage_realtime.sql`: bucket `attachments` (riêng tư) và Realtime.
6. `20261028000100_edit_recall_messages.sql`: sửa và thu hồi tin (giới hạn 2 phút).
7. `20261028000200_typing_and_read_receipts.sql`: kênh "đang nhập" riêng tư và "đã xem".
8. `20261029000100_avatars.sql`: bucket `avatars` (riêng tư) cho ảnh đại diện.

Mỗi file chạy trong một transaction: lỗi ở đâu thì không thay đổi gì. Sau đó chạy
`supabase/tests/verify_schema.sql` (chỉ đọc); dòng `== ALL CHECKS PASSED ==` phải
là `true`.

Kiểm tra thêm trong Dashboard: **Settings → Data API → Exposed schemas** không được
có `private`.

Muốn gỡ riêng phần ảnh đại diện (migration 8), làm theo hướng dẫn ở đầu file
`supabase/rollbacks/20261029000100_avatars_rollback.sql`: script tự từ chối khi còn
hồ sơ dùng ảnh hoặc bucket còn tệp, và không bao giờ xoá dữ liệu người dùng.

### 2. Biến môi trường

```bash
cp .env.example .env.local
```

Điền hai giá trị lấy từ **Dashboard → Project Settings → API**:

| Biến | Giá trị |
| --- | --- |
| `VITE_SUPABASE_URL` | URL dự án, dạng `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (hoặc anon key) |

Mọi biến `VITE_` đều được nhúng vào mã gửi tới trình duyệt. **Không bao giờ** đặt
service_role key hay secret key vào đây; dữ liệu được bảo vệ bằng RLS, không phải
bằng việc giấu key. Thiếu hoặc sai biến thì app hiện màn hình "Chưa cấu hình kết
nối máy chủ".

### 3. Chạy

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra (mặc định http://localhost:5173).

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `npm run dev` | Chạy máy chủ phát triển |
| `npm run build` | Kiểm tra kiểu (tsc) rồi build ra `dist/` |
| `npm run lint` | ESLint |
| `npm run preview` | Xem thử bản build |

## Deploy

App là trang tĩnh (SPA). Build bằng `npm run build` rồi đưa thư mục `dist/` lên bất
kỳ dịch vụ host tĩnh nào, với hai lưu ý:

- **Đặt biến môi trường lúc build**, vì Vite nhúng chúng vào mã khi build, không
  đọc lúc chạy.
- **Chuyển mọi đường dẫn về `index.html`** (rewrite), để mở thẳng `/login` hay
  `/register` hoặc tải lại trang không bị lỗi 404.

Sau khi có tên miền, thêm nó vào **Dashboard → Authentication → URL Configuration**
(Site URL và Redirect URLs) để link xác nhận email trỏ về đúng trang.

## Cấu trúc

```
src/
  main.tsx, App.tsx      khởi động, kiểm tra cấu hình, định tuyến đăng nhập
  components/            giao diện dùng chung; layout/ là màn hình chat
  features/auth/         đăng ký, đăng nhập, phiên
  features/chat/         API tin nhắn, realtime, gửi tin, tệp đính kèm
  features/profile/      hồ sơ: xử lý ảnh, lưu tên và ảnh đại diện
  i18n/                  bản dịch vi / en
  lib/                   Supabase client, kiểm tra cấu hình, link tệp có chữ ký
  routing/               định tuyến tối giản
supabase/
  migrations/            schema, RLS, hàm, trigger, storage
  rollbacks/             script gỡ migration (chạy tay, có điều kiện an toàn)
  tests/                 kiểm tra schema (chỉ đọc)
```

## Hạn chế đã biết

- Ảnh gửi trong chat hiển thị bằng tệp gốc, chưa có ảnh thu nhỏ.
- Quá 2 phút thì không sửa hay thu hồi được tin nữa (có chủ đích).
- Người khác chỉ thấy tên và ảnh đại diện mới khi danh sách chat của họ tải lại.
- Ảnh đại diện không dùng nữa có thể còn lại trên Storage khi mất mạng lúc lưu hoặc
  lúc xoá ảnh cũ (app báo rõ khi việc này xảy ra). Không có cơ chế tự dọn; xoá trong
  **Dashboard → Storage → avatars**.
- Ảnh đại diện chọn từ máy được giới hạn 20 MB và 40 megapixel; giới hạn này không
  chặn được mọi ảnh cố tình làm trình duyệt tốn bộ nhớ khi giải mã.
