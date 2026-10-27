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
    loading: 'Đang tải…',
    retry: 'Thử lại',
    noConversations: 'Chưa có cuộc trò chuyện nào',
    noMessages: 'Chưa có tin nhắn nào',
    errors: {
      network: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.',
      loadFailed: 'Không tải được cuộc trò chuyện. Vui lòng thử lại.',
      sendFailed: 'Không gửi được tin nhắn. Vui lòng thử lại.',
      notAllowed: 'Bạn không có quyền thực hiện thao tác này, hoặc phiên đăng nhập đã hết hạn.',
      messageEmpty: 'Tin nhắn không được để trống.',
      messageTooLong: 'Tin nhắn tối đa {{max}} ký tự.',
    },
  },
  auth: {
    loading: 'Đang tải…',
    logout: 'Đăng xuất',
    loggingOut: 'Đang đăng xuất…',
    fields: {
      username: 'Tên người dùng',
      displayName: 'Tên hiển thị',
      email: 'Email',
      password: 'Mật khẩu',
      passwordConfirm: 'Xác nhận mật khẩu',
      showPassword: 'Hiện mật khẩu',
      hidePassword: 'Ẩn mật khẩu',
    },
    login: {
      title: 'Đăng nhập',
      submit: 'Đăng nhập',
      submitting: 'Đang đăng nhập…',
      noAccount: 'Chưa có tài khoản?',
      toRegister: 'Đăng ký',
    },
    register: {
      title: 'Tạo tài khoản',
      submit: 'Đăng ký',
      submitting: 'Đang tạo tài khoản…',
      hasAccount: 'Đã có tài khoản?',
      toLogin: 'Đăng nhập',
      checkInboxTitle: 'Kiểm tra hộp thư',
      checkInboxBody:
        'Nếu địa chỉ {{email}} hợp lệ, bạn sẽ nhận được email xác nhận. Hãy mở liên kết trong email rồi đăng nhập.',
    },
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
    errors: {
      invalidCredentials: 'Email hoặc mật khẩu không đúng',
      emailNotConfirmed: 'Email chưa được xác nhận. Vui lòng kiểm tra hộp thư.',
      emailAlreadyRegistered: 'Email này đã được đăng ký',
      weakPassword: 'Mật khẩu chưa đủ mạnh. Vui lòng chọn mật khẩu khác.',
      emailInvalid: 'Email không hợp lệ',
      signupDisabled: 'Hiện chưa thể đăng ký tài khoản mới',
      rateLimited: 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau.',
      network: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.',
      signupFailed:
        'Không thể tạo tài khoản. Vui lòng kiểm tra thông tin và thử lại. Nếu lỗi tiếp tục xảy ra, hãy thử một username khác.',
      unexpected: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
      signOutFailed: 'Không thể đăng xuất. Vui lòng kiểm tra kết nối và thử lại.',
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
