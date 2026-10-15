import { useState } from 'react'
import { getMessages, sortConversationsByLastMessage } from '../../features/chat/helpers'
import {
  CURRENT_USER_ID,
  mockConversations,
  mockMessages,
  mockUsers,
} from '../../features/chat/mockData'
import { ChatPanel } from './ChatPanel'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const conversations = sortConversationsByLastMessage(mockConversations, mockMessages)
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null

  // On small screens only one column is visible: the list, or the open chat.
  return (
    <div className="flex h-full">
      <div
        className={`${selected ? 'hidden md:flex' : 'flex'} w-full border-r border-slate-200 md:w-80 md:shrink-0`}
      >
        <Sidebar
          conversations={conversations}
          messages={mockMessages}
          users={mockUsers}
          currentUserId={CURRENT_USER_ID}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <main className={`${selected ? 'flex' : 'hidden md:flex'} min-w-0 flex-1`}>
        <ChatPanel
          conversation={selected}
          messages={selected ? getMessages(mockMessages, selected.id) : []}
          users={mockUsers}
          currentUserId={CURRENT_USER_ID}
          onBack={() => setSelectedId(null)}
        />
      </main>
    </div>
  )
}
