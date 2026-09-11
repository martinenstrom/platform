import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/cases` is now a way into the floor's work, not a separate destination.
 *
 * It used to render under the title *Huvudkontor* while `/agents` held the
 * desks, so the firm had two headquarters and neither was complete. The cases
 * are a section of `/headquarters` now.
 *
 * `/cases/$caseId` is untouched: one case in full is a legitimate drill-down
 * and remains its own page.
 */
export const Route = createFileRoute('/cases/')({
  beforeLoad: () => {
    throw redirect({ to: '/headquarters' })
  },
})
