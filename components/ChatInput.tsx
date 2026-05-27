'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
  onStop?: () => void;
}

export default function ChatInput({ onSend, disabled, onStop }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && value.trim().length > 0;
  const isStreaming = disabled && Boolean(onStop);

  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) onStop?.();
      else submit();
    }
  }

  function submit() {
    const msg = value.trim();
    if (!msg || disabled) return;
    setValue('');
    const el = textareaRef.current;
    if (el) el.style.height = 'auto';
    onSend(msg);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    resizeTextarea();
  }

  function handlePrimaryAction() {
    if (isStreaming) {
      onStop?.();
      return;
    }
    submit();
  }

  return (
    <div className="shrink-0 border-t border-surface-3/80 bg-surface-0/80 backdrop-blur-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pb-4 sm:pt-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handlePrimaryAction();
        }}
        className="mx-auto w-full max-w-4xl"
      >
        <div
          className={`flex items-end gap-2 rounded-2xl border bg-surface-1 px-3 py-2 shadow-sm transition-[border-color,box-shadow] sm:px-4 sm:py-2.5 ${
            disabled && !isStreaming
              ? 'border-surface-3 opacity-90'
              : 'border-surface-3 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(var(--accent)/0.12)]'
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={disabled && !isStreaming}
            placeholder={
              isStreaming
                ? 'Generating response…'
                : 'Message Orthogonal…'
            }
            rows={1}
            aria-label="Message"
            className="min-h-[44px] max-h-48 flex-1 resize-none overflow-y-auto bg-transparent py-2.5 text-[15px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-500 sm:text-sm"
          />

          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={!isStreaming && !canSend}
            aria-label={isStreaming ? 'Stop generating' : 'Send message'}
            className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 ${
              isStreaming
                ? 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                : canSend
                  ? 'bg-accent text-white shadow-sm hover:brightness-110 active:scale-95'
                  : 'cursor-not-allowed bg-surface-2 text-zinc-400 dark:text-zinc-500'
            }`}
          >
            {isStreaming ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="6" width="12" height="12" rx="1.5" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              </svg>
            )}
          </button>
        </div>

        <p className="mt-2 hidden text-center text-[11px] text-zinc-400 sm:block dark:text-zinc-500">
          {isStreaming ? (
            <>Press <kbd className="rounded border border-surface-3 bg-surface-2 px-1 font-sans text-[10px]">Enter</kbd> to stop</>
          ) : (
            <>
              <kbd className="rounded border border-surface-3 bg-surface-2 px-1 font-sans text-[10px]">Enter</kbd> to send ·{' '}
              <kbd className="rounded border border-surface-3 bg-surface-2 px-1 font-sans text-[10px]">Shift</kbd>+
              <kbd className="rounded border border-surface-3 bg-surface-2 px-1 font-sans text-[10px]">Enter</kbd> for new line
            </>
          )}
        </p>
      </form>
    </div>
  );
}
