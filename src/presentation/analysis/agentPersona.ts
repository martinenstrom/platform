/**
 * The firm's AI professionals, as persistent visual identities.
 *
 * ## Persona fiction is allowed; institutional fiction is not
 *
 * A persona is **presentation**. It is how Financial OS shows that Global Macro
 * is a member of an investment organisation rather than a row in a table, and
 * it carries no claim that a human being performed anything. What surrounds the
 * persona — whether the desk has work, whether anything was accepted, whether
 * governance ran, whether the CIO decided — is **institutional state**, and
 * every bit of it comes from the read models.
 *
 * The line is absolute and it runs through this file: nothing here reports
 * status, activity or output. A persona is a name, a role, a portrait and an
 * accent. It never says the desk is *active*.
 *
 * ## A persona is a whole identity, or it is nothing
 *
 * **Portrait, name, desk and title are one object and move together.** They
 * were assigned independently once and drifted: five of the seven photographed
 * desks carried a given name that did not cohere with the person in the
 * portrait, which is what happens when a name is chosen for a desk and a
 * photograph is commissioned for the same desk without either consulting the
 * other.
 *
 * The correction is recorded here rather than in a migration note because this
 * is the file that has to stop it recurring: a persona is constructed from one
 * literal, the portrait path is derived from the department id rather than
 * typed, and nothing anywhere else in the product may name an agent.
 *
 * ## Identity is stable by construction
 *
 * The mapping is a frozen table keyed by `departmentId`, so Global Macro always
 * looks like Global Macro — in the Command Center, in Headquarters, on a desk
 * workspace, in the activity feed, and in whatever surfaces come later. Nothing
 * is chosen at render time and nothing is random; a persona that changed
 * between two screens would be a different colleague on each, which is the
 * opposite of the recognition this exists to build.
 *
 * ## The portrait asset
 *
 * `portrait` is the path a photographic portrait occupies. The art direction
 * the set was shot to is recorded in `PERSONA_ART_DIRECTION` below, beside the
 * identities it governs, so the next commission produces one firm rather than a
 * stock-photo collage.
 *
 * `PERSONA_PORTRAITS` names the identities photography exists for. Where a
 * persona is absent from it, `PersonaPlate` renders a designed monogram in the
 * exact geometry the portrait will occupy: same square, same framing, same
 * lighting treatment. It is deliberately **not** an avatar, a cartoon or a
 * generated face — a placeholder that pretended to be a person would be the one
 * kind of fiction this file is careful about.
 *
 * **Per persona rather than one global switch**, and the reason is measured:
 * the firm seeds fifteen departments and the first commission covered seven.
 * A single flag would have every unphotographed desk request a file that is not
 * there the moment the floor grows past today's six — so the set is the
 * authority, and a persona joins it when its portrait lands.
 */

/** Where a persona's portrait lives once it exists. */
const PORTRAIT_DIR = '/data/personas'

/**
 * The identities photography exists for.
 *
 * Kept beside the personas so the two cannot drift: adding a file to
 * `public/data/personas/` without adding its id here leaves the monogram in
 * place, and adding an id without the file is the only way to produce a broken
 * portrait — which `personaPortrait` refuses to do by consulting this set
 * rather than guessing from the path.
 */
const PERSONA_PORTRAITS: ReadonlySet<string> = new Set([
  'executive',
  'global-macro',
  'quant-technical',
  'research-office',
  'devils-advocate',
  'risk',
  'verification',
])

/**
 * The persona's portrait, or `null` where no photograph exists for it yet.
 *
 * `null` is the honest answer and the surface renders a monogram for it. A path
 * returned for a file that is not there would be a broken image on the firm's
 * own floor.
 */
export function personaPortrait(persona: AgentPersona): string | null {
  return PERSONA_PORTRAITS.has(persona.departmentId) ? persona.portrait : null
}

export interface AgentPersona {
  /** The institutional identity this persona represents. */
  departmentId: string
  /** The persona's own name. Fiction, and never presented as an employee. */
  displayName: string
  /** The seat, which is institutional and comes from the organisation. */
  roleTitle: string
  /** Two letters, used by the plate and by compact surfaces. */
  monogram: string
  /** The portrait, once photography exists for it. */
  portrait: string
  /**
   * The persona's register, for whoever art-directs the portrait.
   *
   * Kept beside the identity rather than in a separate brief, because a
   * portrait produced without it is how a set of professionals stops looking
   * like one firm.
   */
  character: string
}

/**
 * The art direction every portrait shares.
 *
 * Recorded in the code that consumes the assets so it cannot drift from them:
 * one firm, one lighting setup, one wardrobe register, one background world.
 */
export const PERSONA_ART_DIRECTION = [
  'Institutional investment professionals, Scandinavian private-banking register.',
  'Premium editorial photography — sophisticated, never futuristic, never stock.',
  'Dark formal business attire; restrained, composed expressions; no smiling to camera.',
  'Consistent key light from the upper left, cool navy fill, warm bronze rim.',
  'Backgrounds: dark investment-floor interiors, shallow depth of field, no logos.',
  'Framing: head and shoulders, eyes on the upper third, square crop.',
  'No cartoon or avatar aesthetic. No visible brand marks. One coherent universe.',
] as const

const persona = (
  departmentId: string,
  displayName: string,
  roleTitle: string,
  monogram: string,
  character: string,
): AgentPersona => ({
  departmentId,
  displayName,
  roleTitle,
  monogram,
  portrait: `${PORTRAIT_DIR}/${departmentId}.jpg`,
  character,
})

/**
 * The firm's professionals.
 *
 * One entry per seeded department, so the table covers the organisation as it
 * actually exists rather than the subset a screen happens to show today.
 */
export const AGENT_PERSONAS: Readonly<Record<string, AgentPersona>> = Object.freeze({
  executive: persona(
    'executive',
    'Anders Wikström',
    'Chief Investment Officer',
    'AW',
    'The most senior identity in the firm. Older, still, unhurried; the only persona photographed slightly further back, as though mid-thought rather than mid-answer.',
  ),
  'global-macro': persona(
    'global-macro',
    'Henrik Sjöberg',
    'Head of Macro',
    'HS',
    'Reads central banks for a living. Direct, analytical, faintly sceptical; the expression of someone who has heard a policy statement before.',
  ),
  'equity-research': persona(
    'equity-research',
    'Marcus Lindqvist',
    'Head of Equity Research',
    'ML',
    'Company-level rigour. Precise, measured, the calm of someone who has read the footnotes.',
  ),
  'quant-technical': persona(
    'quant-technical',
    'Ivar Fors',
    'Head of Quant & Technical Analysis',
    'IF',
    'Model-first. Contained and exact; the least performative person in the room.',
  ),
  'research-office': persona(
    'research-office',
    'Johanna Hedlund',
    'Research Director',
    'JH',
    'Synthesises the desks. Attentive rather than assertive — the register of someone whose job is to weigh other people’s work.',
  ),
  'news-intelligence': persona(
    'news-intelligence',
    'Sofia Ahlberg',
    'Head of News Intelligence',
    'SA',
    'Watches flow and narrative. Alert, quick-eyed, the only persona with any sense of motion.',
  ),
  'flow-positioning': persona(
    'flow-positioning',
    'Nils Ekström',
    'Head of Flow & Positioning',
    'NE',
    'Positioning and crowding. Watchful, hard to read, comfortable with being early.',
  ),
  'behavioural-finance': persona(
    'behavioural-finance',
    'Karin Löfgren',
    'Head of Behavioural Finance',
    'KL',
    'Studies how the firm itself errs. Observant and quietly amused; the person who watches the room rather than the screen.',
  ),
  'portfolio-strategy': persona(
    'portfolio-strategy',
    'Erik Dahlén',
    'Portfolio Strategy Manager',
    'ED',
    'Translates views into structure. Practical, steady, unromantic about markets.',
  ),
  'market-intelligence-office': persona(
    'market-intelligence-office',
    'Petra Nyström',
    'Market Intelligence Manager',
    'PN',
    'Keeps the firm’s picture of the market current. Organised and unflappable.',
  ),
  editorial: persona(
    'editorial',
    'Anna Berglund',
    'Editorial Director',
    'AB',
    'Owns how the firm says things. Exacting about language; the register of a good editor.',
  ),

  /* -------------------------------------------- independent control functions */

  /*
   * The governance personas are photographed with the same care and the same
   * seniority as the desks they review. A control function rendered as a junior
   * version of a specialist would put a reporting line in the picture that the
   * firm does not have.
   */
  verification: persona(
    'verification',
    'Tove Öberg',
    'Head of Verification',
    'TÖ',
    'Checks the numbers against the sources. Unhurried, literal, entirely unmoved by how good an argument sounds.',
  ),
  'devils-advocate': persona(
    'devils-advocate',
    'Rickard Alm',
    "Head of Devil's Advocate",
    'RA',
    'Paid to disagree. Composed and faintly adversarial; the one persona whose expression asks a question back.',
  ),
  risk: persona(
    'risk',
    'Gustav Rehn',
    'Chief Risk Officer',
    'GR',
    'Independent authority. Grave without being severe; the person who says no and means it.',
  ),
  compliance: persona(
    'compliance',
    'Maria Sandell',
    'Head of Compliance',
    'MS',
    'Formal, exact, immovable. The most conservatively photographed persona in the firm.',
  ),
})

/** The CIO, who heads the firm and has a seat on the floor. */
export const CIO_PERSONA = AGENT_PERSONAS.executive!

/**
 * The persona for a department, or `null` when the firm has none registered.
 *
 * Returns `null` rather than inventing one: a department with no persona is a
 * gap in the presentation table, and rendering a generated stand-in would make
 * that gap invisible exactly where somebody should notice it.
 */
export function personaFor(departmentId: string): AgentPersona | null {
  return AGENT_PERSONAS[departmentId] ?? null
}
