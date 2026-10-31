# ChatSOS

Ứng dụng nhắn tin web: chat riêng, nhóm, gửi ảnh và tệp, nhận tin tức thì.
Frontend React chạy hoàn toàn trên trình duyệt; dữ liệu, đăng nhập, lưu tệp và
realtime dùng [Supabase](https://supabase.com). Giao diện tiếng Việt và tiếng Anh.

## Tính năng

- Đăng ký bằng email, tên người dùng, số điện thoại di động Việt Nam và mật khẩu (hỗ trợ
  cả khi bật xác nhận email). Mỗi số điện thoại chỉ dùng cho một tài khoản.
- Đăng nhập bằng email hoặc số điện thoại cùng mật khẩu. Đăng nhập bằng số điện thoại
  cần Edge Function `phone-sign-in` (xem mục 3 phần Cài đặt).
- Quên mật khẩu: nhập email, nhận mã khôi phục qua email, đặt mật khẩu mới. Sau khi lưu,
  các thiết bị khác đang đăng nhập tài khoản đó bị đăng xuất.
- Tìm người dùng theo tên hoặc đúng số điện thoại để chat riêng; tạo nhóm có tên và
  thành viên. Số điện thoại không bao giờ hiện cho người khác.
- Có giới hạn số lần thử: 5 lần đăng nhập bằng một số điện thoại mỗi 15 phút, 20 lần tìm
  theo số điện thoại mỗi người mỗi 10 phút.
- Người quản trị xem danh sách tài khoản (hồ sơ, số điện thoại, hoạt động) trong
  **Dashboard → Table Editor → schema `admin`**, view `users`. View này không truy cập
  được qua API.
- Gửi tin văn bản ngay lập tức trên giao diện; mất mạng thì báo lỗi, bấm "Thử lại"
  là gửi tiếp mà không bao giờ bị trùng tin.
- Gửi ảnh (JPG, PNG, WebP, GIF) và tệp (PDF, TXT, ZIP, DOCX, XLSX, PPTX), tối đa
  20 MB: bằng nút 📎, dán (Ctrl+V) hoặc kéo thả. Ảnh xem ngay trong chat, tệp tải về
  giữ đúng tên gốc.
- Sửa tin văn bản trong 2 phút sau khi gửi; người kia thấy ngay.
- Xoá tin: chọn một hoặc nhiều tin (tối đa 100) rồi chọn "Xoá ở phía tôi" (chỉ mất với
  mình, người khác vẫn thấy) hoặc "Xoá với mọi người" (chỉ tin của mình, trong 2 phút
  sau khi gửi; ai cũng thấy "Tin nhắn này đã bị xoá", nội dung bị xoá trên server,
  ảnh/tệp bị xoá khỏi Storage).
- Xoá cuộc trò chuyện (nút ⋯ ở mỗi dòng chat): lịch sử chỉ bị xoá ở phía mình, người
  khác vẫn giữ. Khi có tin mới, cuộc trò chuyện hiện lại, chỉ với các tin từ lúc đó.
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

Mở **Supabase Dashboard → SQL Editor** và chạy lần lượt 11 file trong
`supabase/migrations/`, mỗi lần một file, theo đúng thứ tự tên file:

1. `20261016000100_profiles.sql`: hồ sơ người dùng.
2. `20261016000200_conversations.sql`: cuộc trò chuyện, thành viên, tin nhắn và RLS.
3. `20261016000300_rpc.sql`: hàm tạo chat riêng và nhóm.
4. `20261016000400_message_triggers.sql`: kiểm tra tin nhắn và tệp đính kèm.
5. `20261016000500_storage_realtime.sql`: bucket `attachments` (riêng tư) và Realtime.
6. `20261028000100_edit_recall_messages.sql`: sửa và thu hồi tin (giới hạn 2 phút).
7. `20261028000200_typing_and_read_receipts.sql`: kênh "đang nhập" riêng tư và "đã xem".
8. `20261029000100_avatars.sql`: bucket `avatars` (riêng tư) cho ảnh đại diện.
9. `20261030000100_delete_messages_and_conversations.sql`: xoá tin và xoá lịch sử cuộc
   trò chuyện ở phía mình; Realtime không còn gửi sự kiện DELETE.
10. `20261031000100_phone_and_admin_users.sql`: số điện thoại trong hồ sơ, hook kiểm tra
    lúc đăng ký, tìm theo số điện thoại, view `admin.users`.
11. `20261101000100_rate_limits.sql`: giới hạn số lần đăng nhập bằng số điện thoại và số
    lần tìm theo số điện thoại.

Mỗi file chạy trong một transaction: lỗi ở đâu thì không thay đổi gì. Sau đó chạy
`supabase/tests/verify_schema.sql` (chỉ đọc); dòng `== ALL CHECKS PASSED ==` phải
là `true`. Có thể chạy thêm `supabase/tests/rate_limits_behaviour.sql` để thử các giới
hạn: script luôn kết thúc bằng một lỗi có chữ `ALL n CHECKS PASSED` hoặc `FAILED`, và
mọi thứ nó ghi đều được rollback.

Kiểm tra thêm trong Dashboard: **Settings → Data API → Exposed schemas** không được
có `private`.

Muốn gỡ riêng phần ảnh đại diện (migration 8), làm theo hướng dẫn ở đầu file
`supabase/rollbacks/20261029000100_avatars_rollback.sql`: script tự từ chối khi còn
hồ sơ dùng ảnh hoặc bucket còn tệp, và không bao giờ xoá dữ liệu người dùng.

Tương tự, `supabase/rollbacks/20261030000100_delete_messages_and_conversations_rollback.sql`
gỡ migration 9. Script tự từ chối khi còn tin đã ẩn hoặc mốc xoá lịch sử, vì gỡ đi thì
những tin người dùng đã xoá sẽ hiện lại với họ.

Gỡ migration 11 bằng `supabase/rollbacks/20261101000100_rate_limits_rollback.sql`, sau khi
đã gỡ hoặc tắt Edge Function `phone-sign-in`. Gỡ migration 10 bằng
`supabase/rollbacks/20261031000100_phone_and_admin_users_rollback.sql`, sau khi đã tắt
hook *Before User Created*. Script tự từ chối khi còn hồ sơ có số điện thoại; hướng dẫn
chi tiết nằm ở đầu từng file.

### 2. Cấu hình Auth trong Dashboard

- **Authentication → Hooks → Before User Created**: chọn hàm Postgres
  `public.hook_before_user_created`. Có hook, đăng ký trùng hoặc sai tên người dùng / số
  điện thoại sẽ báo lỗi rõ ràng. Không có hook thì những đăng ký đó vẫn bị chặn, nhưng chỉ
  nhận lỗi chung chung.
- **Authentication → Email Templates → Reset Password**: nội dung email phải chứa mã
  `{{ .Token }}`, vì trang quên mật khẩu yêu cầu nhập mã chứ không dùng link.
- **Thời hạn mã khôi phục** (Email OTP Expiration trong phần cài đặt Email của
  Authentication): nên đặt 900 giây (15 phút).

### 3. Edge Function đăng nhập bằng số điện thoại

Supabase Auth chỉ đăng nhập bằng email (đăng nhập bằng điện thoại của nó cần dịch vụ SMS
trả phí). Function `supabase/functions/phone-sign-in` tìm email của tài khoản theo số điện
thoại bằng secret key ở phía server rồi đăng nhập, nên email không bao giờ tới trình duyệt.
Deploy bằng Supabase CLI, **tắt kiểm tra JWT** vì người gọi chưa đăng nhập:

```bash
supabase functions deploy phone-sign-in --no-verify-jwt
```

Secret tuỳ chọn `PHONE_SIGN_IN_IP_HEADER`: tên header chứa IP người gọi, dùng để giới hạn
60 lần thử mỗi IP trong 15 phút. Chỉ đặt khi đã chắc người gọi không giả mạo được header
đó; để trống thì chỉ giới hạn theo số điện thoại. Chưa deploy function thì đăng nhập
bằng số điện thoại báo "Tạm thời chưa đăng nhập được bằng số điện thoại", còn đăng nhập
bằng email vẫn chạy bình thường.

Kiểm thử logic của function (không cần Supabase, Node 22.18 trở lên):

```bash
node --test supabase/functions/phone-sign-in/handler.test.mjs
```

### 4. Biến môi trường

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

### 5. Chạy

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
  features/auth/         đăng ký, đăng nhập (email / số điện thoại), quên mật khẩu, phiên
  features/chat/         API tin nhắn, realtime, gửi tin, tệp đính kèm
  features/profile/      hồ sơ: xử lý ảnh, lưu tên và ảnh đại diện
  i18n/                  bản dịch vi / en
  lib/                   Supabase client, kiểm tra cấu hình, link tệp có chữ ký
  routing/               định tuyến tối giản
supabase/
  migrations/            schema, RLS, hàm, trigger, storage
  functions/             Edge Function phone-sign-in và test của nó
  rollbacks/             script gỡ migration (chạy tay, có điều kiện an toàn)
  tests/                 kiểm tra schema (chỉ đọc) và thử giới hạn (tự rollback)
```

## Hạn chế đã biết

- Ảnh gửi trong chat hiển thị bằng tệp gốc, chưa có ảnh thu nhỏ.
- Quá 2 phút thì không sửa hay xoá tin với mọi người được nữa (có chủ đích).
- "Xoá ở phía tôi" và xoá cuộc trò chuyện không hoàn tác được. Ở tab hoặc thiết bị khác
  của cùng tài khoản, tin hay cuộc trò chuyện vừa xoá chỉ biến mất sau khi tải lại.
- Không có chức năng xoá hẳn cuộc trò chuyện hay rời nhóm; muốn xoá hẳn phải dùng
  **Dashboard**.
- Người khác chỉ thấy tên và ảnh đại diện mới khi danh sách chat của họ tải lại.
- Ảnh đại diện không dùng nữa có thể còn lại trên Storage khi mất mạng lúc lưu hoặc
  lúc xoá ảnh cũ (app báo rõ khi việc này xảy ra). Không có cơ chế tự dọn; xoá trong
  **Dashboard → Storage → avatars**.
- Ảnh đại diện chọn từ máy được giới hạn 20 MB và 40 megapixel; giới hạn này không
  chặn được mọi ảnh cố tình làm trình duyệt tốn bộ nhớ khi giải mã.
- Số điện thoại không được xác minh bằng SMS: ai đăng ký trước thì giữ số đó. Chỉ nhận số
  di động Việt Nam.
- Tài khoản tạo trước khi có tính năng số điện thoại không có số, nên chỉ đăng nhập được
  bằng email, và chưa có màn hình để thêm số sau.
- Quên mật khẩu chỉ khôi phục qua email, kể cả với người thường đăng nhập bằng số điện
  thoại.
- Đăng nhập bằng số điện thoại chỉ chạy khi đã deploy Edge Function `phone-sign-in`.
  Chưa đặt `PHONE_SIGN_IN_IP_HEADER` thì không có giới hạn theo IP.
