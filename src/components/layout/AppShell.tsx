import { useRef, useState } from 'react'
import { useAuth } from '../../features/auth/useAuth'
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
  const { signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)
  // Blocks a second click before the signingOut state has re-rendered the button.
  const signingOutRef = useRef(false)

  // Never rejects, so the `void` call below cannot leave an unhandled rejection. It never
  // navigates either: when the session was removed, the auth listener has already
  // reported signedOut and the route guard replaces this screen. When it is still there,
  // the status stays signedIn, the error is shown and the button can be used again.
  async function handleSignOut() {
    if (signingOutRef.current) return
    signingOutRef.current = true
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      const result = await signOut()
      if (!result.ok) setSignOutFailed(true)
    } catch {
      // signOut() reports failures in its result; this covers an unexpected throw.
      setSignOutFailed(true)
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }

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
          onSignOut={() => void handleSignOut()}
          signingOut={signingOut}
          signOutFailed={signOutFailed}
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
