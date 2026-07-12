import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Editor } from '@tiptap/core'

export interface ManuscriptEditorHandle {
  getSelectionText: () => string
}

function proseToHtml(prose: string): string {
  return prose
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface Props {
  sceneId: string
  prose: string
  onProseChange: (prose: string) => void
  // Bump this to force the editor to reload `prose` from outside (e.g. an
  // accepted suggestion rewrote the scene on disk). Normal typing must NOT
  // trigger a reload — that would reset the cursor on every keystroke —
  // hence this is a separate signal from `prose` itself.
  reloadToken?: number
}

export const ManuscriptEditor = forwardRef<ManuscriptEditorHandle, Props>(function ManuscriptEditor(
  { sceneId, prose, onProseChange, reloadToken = 0 },
  ref
) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: proseToHtml(prose),
    onUpdate: ({ editor }: { editor: Editor }) => {
      onProseChange(editor.getText({ blockSeparator: '\n\n' }))
    }
  })

  const lastSceneId = useRef(sceneId)
  const lastReloadToken = useRef(reloadToken)
  useEffect(() => {
    if (!editor) return
    if (lastSceneId.current !== sceneId || lastReloadToken.current !== reloadToken) {
      editor.commands.setContent(proseToHtml(prose))
      lastSceneId.current = sceneId
      lastReloadToken.current = reloadToken
    }
  }, [editor, sceneId, prose, reloadToken])

  useImperativeHandle(ref, () => ({
    getSelectionText: () => {
      if (!editor) return ''
      const { from, to } = editor.state.selection
      return editor.state.doc.textBetween(from, to, '\n')
    }
  }))

  return (
    <div className="manuscript-page" style={{ color: 'var(--c-ink)' }}>
      <EditorContent editor={editor} />
    </div>
  )
})
