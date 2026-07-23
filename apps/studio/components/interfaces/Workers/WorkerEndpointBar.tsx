import { ArrowUpRight, ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { useState } from 'react'
import { Button } from 'ui'
import { CodeBlock } from 'ui-patterns/CodeBlock'

import CopyButton from '@/components/ui/CopyButton'
import { DOCS_URL } from '@/lib/constants'

/**
 * Compact public-endpoint row with expandable "how to call" docs — the gateway
 * auth model isn't obvious, so we show a ready-to-run curl snippet inline plus
 * a link to the full docs.
 */
export const WorkerEndpointBar = ({ endpoint }: { endpoint: string }) => {
  const [showDocs, setShowDocs] = useState(false)

  const curl = [
    `curl -X POST '${endpoint}' \\`,
    `  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{ "hello": "world" }'`,
  ].join('\n')

  return (
    <div className="rounded-md border border-default bg-surface-100">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Lock size={13} strokeWidth={1.5} className="shrink-0 text-foreground-lighter" />
        <code className="min-w-0 flex-1 truncate text-xs text-foreground-light">{endpoint}</code>
        <span className="hidden shrink-0 text-xs text-foreground-lighter md:inline">
          Gateway auth required
        </span>
        <CopyButton iconOnly variant="text" size="tiny" text={endpoint} />
        <Button
          variant="text"
          size="tiny"
          icon={showDocs ? <ChevronUp /> : <ChevronDown />}
          onClick={() => setShowDocs((value) => !value)}
        >
          How to call
        </Button>
      </div>

      {showDocs && (
        <div className="space-y-3 border-t border-default px-3 py-3">
          <p className="text-xs text-foreground-light">
            Requests are proxied through the Supabase API Gateway, which validates a Supabase Auth
            key before forwarding to your worker. Pass your anon key (or a user access token) as a
            Bearer token. HTTP, WebSockets and SSE are supported; there's no load balancing across
            instances at alpha.
          </p>
          <CodeBlock language="bash" hideLineNumbers className="text-xs">
            {curl}
          </CodeBlock>
          <a
            href={`${DOCS_URL}/guides/workers`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-foreground-light hover:text-foreground"
          >
            Read the endpoint docs
            <ArrowUpRight size={12} />
          </a>
        </div>
      )}
    </div>
  )
}
