import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  downloadAttachment,
  formatFileSize,
  useAttachmentUrl,
} from '../features/chat/attachments'
import type { Attachment } from '../features/chat/types'
import { DEFAULT_LANGUAGE } from '../i18n'

interface AttachmentViewProps {
  kind: 'image' | 'file'
  attachment: Attachment
  // Still being sent: the file may not be uploaded yet, so it cannot be downloaded.
  pending?: boolean
  // An image finished loading, which changes the message's height.
  onLoad?: () => void
}

// Images are shown inline; other files as a name, a size and a download button. Files
// are never rendered as HTML: images use <img>, everything else downloads.
export function AttachmentView({ kind, attachment, pending = false, onLoad }: AttachmentViewProps) {
  if (kind === 'image') return <ImageAttachment attachment={attachment} onLoad={onLoad} />
  return <FileAttachment attachment={attachment} pending={pending} />
}

function ImageAttachment({ attachment, onLoad }: { attachment: Attachment; onLoad?: () => void }) {
  const { t } = useTranslation()
  const url = useAttachmentUrl(attachment.path)

  if (url.status === 'loading') {
    return <div role="status" aria-label={t('chat.loading')} className="h-40 w-56 max-w-full animate-pulse rounded-lg bg-slate-200" />
  }
  if (url.status === 'error') {
    return <p className="text-sm text-slate-500 italic">{t('chat.attachmentUnavailable')}</p>
  }
  return (
    <a
      href={url.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('chat.openImage', { name: attachment.name })}
      className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      <img
        src={url.url}
        alt={attachment.name}
        onLoad={onLoad}
        className="block max-h-72 max-w-full rounded-lg object-contain"
      />
    </a>
  )
}

function FileAttachment({ attachment, pending }: { attachment: Attachment; pending: boolean }) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')

  async function handleDownload() {
    setState('busy')
    const ok = await downloadAttachment(attachment.path, attachment.name)
    setState(ok ? 'idle' : 'failed')
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/70 text-lg">
        📄
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="block text-xs text-slate-500">
          {formatFileSize(attachment.size, language)}
        </span>
        {state === 'failed' && (
          <span role="alert" className="block text-xs text-red-700">
            {t('chat.errors.downloadFailed')}
          </span>
        )}
      </span>
      {!pending && (
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={state === 'busy'}
          aria-label={t('chat.downloadFile', { name: attachment.name })}
          className="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50"
        >
          {t('chat.download')}
        </button>
      )}
    </div>
  )
}
