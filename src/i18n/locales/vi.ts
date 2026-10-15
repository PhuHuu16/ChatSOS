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
}

export type Translation = typeof vi
