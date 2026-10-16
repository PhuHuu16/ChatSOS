export const vi = {
  app: { name: 'ChatSOS' },
  language: { label: 'Ngôn ngữ', vi: 'Tiếng Việt', en: 'English' },
  chat: {
    listLabel: 'Danh sách trò chuyện',
    emptyState: 'Chọn một cuộc trò chuyện để bắt đầu nhắn tin',
    // Vietnamese has no plural forms; both keys exist so vi and en share one shape.
    members_one: '{{count}} thành viên',
    members_other: '{{count}} thành viên',
    direct: 'Trò chuyện riêng',
    you: 'Bạn',
    back: 'Quay lại',
    composerPlaceholder: 'Nhập tin nhắn…',
    send: 'Gửi',
    previewNotice: 'Chế độ xem trước: chưa thể gửi tin nhắn',
  },
  auth: {
    validation: {
      required: 'Vui lòng nhập thông tin này',
      usernameFormat:
        'Tên người dùng gồm 3–32 ký tự: chữ thường không dấu, số hoặc dấu gạch dưới',
      displayNameLength: 'Tên hiển thị dài từ 1 đến 64 ký tự',
      displayNameInvalid: 'Tên hiển thị chứa ký tự không hợp lệ',
      emailInvalid: 'Email không hợp lệ',
      // Keep the number in sync with PASSWORD_MIN_LENGTH in features/auth/validation.ts.
      passwordTooShort: 'Mật khẩu cần ít nhất 8 ký tự',
      passwordMismatch: 'Mật khẩu xác nhận không khớp',
    },
  },
  config: {
    title: 'Chưa cấu hình kết nối máy chủ',
    description:
      'ChatSOS chưa được cấu hình đúng để kết nối máy chủ. Vui lòng liên hệ quản trị viên.',
    loadFailedTitle: 'Không tải được ứng dụng',
    loadFailedDescription: 'Đã có lỗi khi tải ChatSOS. Vui lòng kiểm tra kết nối và thử lại.',
    reload: 'Tải lại',
  },
}

export type Translation = typeof vi
