/**
 * An AI professional's portrait.
 *
 * ## What it renders, and what it refuses to
 *
 * A persona is presentation: a name, a seat, a face. This component draws it
 * and nothing else — **no status light, no "AKTIV", no activity**. Whether a
 * desk is working is institutional state, it lives in the read models, and the
 * module around this plate renders it. A portrait that carried its own status
 * would be exactly the fabrication the reference's agent cards commit.
 *
 * ## Where photography does not exist yet
 *
 * `personaPortrait` returns `null` for an identity the firm has not
 * photographed, and the plate renders a designed monogram in the exact geometry
 * the photograph would occupy — same square, same framing, same lighting
 * direction. Seven of the fifteen personas are photographed today; the rest sit
 * in monogram until their portraits arrive, and the composition does not move
 * when they do.
 *
 * The monogram is deliberately not an avatar, a cartoon or a generated face. A
 * placeholder that pretended to be a person would put a fictional human where
 * the product is careful to put none.
 */

import { personaPortrait, type AgentPersona } from '~/presentation/analysis/agentPersona'
import { cn } from '~/lib/cn'

export function PersonaPlate({
  persona,
  size = 'md',
  governance = false,
  chief = false,
  className,
}: {
  persona: AgentPersona
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  governance?: boolean
  chief?: boolean
  className?: string
}) {
  /*
   * Sized to the reference, where the face is a substantial part of an agent
   * card rather than an icon beside a label. The firm is meant to read as
   * people at desks.
   */
  const dimension =
    size === '2xl'
      ? 'h-24 w-24'
      : size === 'xl'
        ? 'h-[4.5rem] w-[4.5rem]'
        : size === 'lg'
          ? 'h-16 w-16'
          : size === 'md'
            ? 'h-12 w-12'
            : 'h-8 w-8'
  const portrait = personaPortrait(persona)

  return (
    <span
      className={cn(
        'ref-portrait shrink-0',
        dimension,
        governance && 'ref-portrait-governance',
        chief && 'ref-portrait-chief',
        className,
      )}
      /*
       * The persona is decorative here: the module states the desk's name and
       * role in text beside it, so announcing the face again would read the
       * same identity twice.
       */
      aria-hidden="true"
    >
      {portrait ? (
        <img
          src={portrait}
          alt=""
          loading="lazy"
          /*
           * `object-cover` on a square plate: the portraits are shot square to
           * the brief, so nothing is cropped, and a future portrait that is not
           * would centre rather than distort.
           */
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <span
            className={cn(
              'font-medium tracking-[0.04em] text-institution/85',
              size === '2xl' || size === 'xl' || size === 'lg'
                ? 'text-[17px]'
                : size === 'md'
                  ? 'text-[13px]'
                  : 'text-[10px]',
            )}
          >
            {persona.monogram}
          </span>
        </span>
      )}
    </span>
  )
}
