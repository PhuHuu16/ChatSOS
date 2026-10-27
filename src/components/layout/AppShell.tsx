import { useRef, useState } from 'react'
import { useAuth } from '../../features/auth/useAuth'
import { fetchConversationList, fetchMessages } from '../../features/chat/api'
import { useChatQuery } from '../../features/chat/useChatQuery'
import { ChatPanel } from './ChatPanel'
import { Sidebar } from './Sidebar'

// useChatQuery needs a stable loader; the list has no key of its own.
const CONVERSATION_LIST_KEY = 'conversations'
const loadConversationList = () => fetchConversationList()

export function AppShell() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { session, signOut } = useAuth()
  // AppShell is only rendered for the signedIn status, so the session is present.
  const currentUserId = session?.user.id ?? ''
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

  const list = useChatQuery(CONVERSATION_LIST_KEY, loadConversationList)
  const listData = list.status === 'ready' ? list.data : null
  const conversations = listData?.conversations ?? []
  const users = listData?.users ?? []
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
  const messages = useChatQuery(selected?.id ?? null, fetchMessages)

  // On small screens only one column is visible: the list, or the open chat.
  return (
    <div className="flex h-full">
      <div
        className={`${selected ? 'hidden md:flex' : 'flex'} w-full border-r border-slate-200 md:w-80 md:shrink-0`}
      >
        <Sidebar
          list={list}
          conversations={conversations}
          lastMessages={listData?.lastMessages ?? []}
          users={users}
          currentUserId={currentUserId}
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
          messages={messages}
          users={users}
          currentUserId={currentUserId}
          onBack={() => setSelectedId(null)}
        />
      </main>
    </div>
  )
}
