import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { OfficeForm } from '~/components/clients/lifecycle/OfficeForms'
import { PageShell } from '~/components/layout/PageHeader'
import { createOfficeFn } from '~/infrastructure/advisory/lifecycle/serverFns'

/** Nytt kontor — an office enters the register; its book opens empty, with zero clients and zero AUM. */
export const Route = createFileRoute('/clients/office/new')({
  component: NewOfficePage,
})

function NewOfficePage() {
  const navigate = useNavigate()
  return (
    <PageShell className="gap-3">
      <header className="px-1 pt-3 pb-1">
        <p className="type-section text-institution">Client Intelligence</p>
        <h1 className="type-display-name mt-1.5 text-[44px] leading-none">Nytt kontor</h1>
        <p className="mt-2 max-w-[30rem] font-display text-[15px] leading-snug text-content-muted">
          Ett nytt kontor öppnar med en tom bok: noll klienter, noll AUM och ingen läsning
          från JARVIS förrän det finns något att läsa.
        </p>
      </header>
      <OfficeForm
        onSubmit={(values) =>
          createOfficeFn({
            data: {
              displayName: values.displayName,
              shortName: values.shortName || null,
              city: values.city,
              description: values.description || null,
            },
          })
        }
        onDone={(office) =>
          void navigate({
            to: '/clients/office/$officeId',
            params: { officeId: office.id },
          })
        }
      />
    </PageShell>
  )
}
