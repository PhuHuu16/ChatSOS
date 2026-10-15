// TEMPORARY: fictional data for UI scaffolding. Remove in Phase 4 when messages come from Supabase.
import type { Conversation, Message, User } from './types'

export const CURRENT_USER_ID = 'u-me'

export const mockUsers: User[] = [
  { id: 'u-me', displayName: 'Nguyễn Văn An' },
  { id: 'u-binh', displayName: 'Trần Thị Bình' },
  { id: 'u-cuong', displayName: 'Lê Hoàng Cường' },
  { id: 'u-dung', displayName: 'Phạm Thu Dung' },
]

export const mockConversations: Conversation[] = [
  { id: 'c-binh', type: 'direct', title: null, memberIds: ['u-me', 'u-binh'] },
  { id: 'c-cuong', type: 'direct', title: null, memberIds: ['u-me', 'u-cuong'] },
  {
    id: 'c-team',
    type: 'group',
    title: 'Nhóm dự án ChatSOS',
    memberIds: ['u-me', 'u-binh', 'u-cuong', 'u-dung'],
  },
]

export const mockMessages: Message[] = [
  {
    id: 'm-01',
    conversationId: 'c-binh',
    senderId: 'u-binh',
    kind: 'text',
    content: 'Chào An, chiều nay mình họp lúc mấy giờ nhỉ?',
    createdAt: '2026-10-15T09:12:00+07:00',
  },
  {
    id: 'm-02',
    conversationId: 'c-binh',
    senderId: 'u-me',
    kind: 'text',
    content: 'Chào Bình, 3 giờ chiều nhé.',
    createdAt: '2026-10-15T09:15:00+07:00',
  },
  {
    id: 'm-03',
    conversationId: 'c-binh',
    senderId: 'u-binh',
    kind: 'text',
    content: 'Ok, mình sẽ chuẩn bị tài liệu.',
    createdAt: '2026-10-15T09:16:00+07:00',
  },
  {
    id: 'm-04',
    conversationId: 'c-binh',
    senderId: 'u-me',
    kind: 'text',
    content: 'Cảm ơn bạn!',
    createdAt: '2026-10-15T09:30:00+07:00',
  },
  {
    id: 'm-05',
    conversationId: 'c-cuong',
    senderId: 'u-cuong',
    kind: 'text',
    content: 'An ơi, bản thiết kế mới đã xong chưa?',
    createdAt: '2026-10-15T07:58:00+07:00',
  },
  {
    id: 'm-06',
    conversationId: 'c-cuong',
    senderId: 'u-me',
    kind: 'text',
    content: 'Gần xong rồi, mình gửi trong hôm nay.',
    createdAt: '2026-10-15T08:02:00+07:00',
  },
  {
    id: 'm-07',
    conversationId: 'c-cuong',
    senderId: 'u-cuong',
    kind: 'text',
    content: 'Tuyệt, cảm ơn nhé.',
    createdAt: '2026-10-15T08:05:00+07:00',
  },
  {
    id: 'm-08',
    conversationId: 'c-team',
    senderId: 'u-dung',
    kind: 'text',
    content: 'Chào cả nhóm! Mình vừa cập nhật danh sách công việc tuần này.',
    createdAt: '2026-10-15T10:20:00+07:00',
  },
  {
    id: 'm-09',
    conversationId: 'c-team',
    senderId: 'u-binh',
    kind: 'text',
    content: 'Cảm ơn Dung, mình nhận phần giao diện đăng nhập.',
    createdAt: '2026-10-15T10:24:00+07:00',
  },
  {
    id: 'm-10',
    conversationId: 'c-team',
    senderId: 'u-cuong',
    kind: 'text',
    content: 'Mình làm phần cơ sở dữ liệu và phân quyền.',
    createdAt: '2026-10-15T10:31:00+07:00',
  },
  {
    id: 'm-11',
    conversationId: 'c-team',
    senderId: 'u-me',
    kind: 'text',
    content: 'Tốt quá. Mình sẽ lo phần nhắn tin thời gian thực.',
    createdAt: '2026-10-15T10:38:00+07:00',
  },
  {
    id: 'm-12',
    conversationId: 'c-team',
    senderId: 'u-dung',
    kind: 'text',
    content: 'Thứ Sáu mình cùng demo nhé!',
    createdAt: '2026-10-15T10:45:00+07:00',
  },
]
