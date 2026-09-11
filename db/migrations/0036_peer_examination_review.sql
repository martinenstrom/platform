-- Peer examination: a fifth review kind.
--
-- `reviews_kind_known` admitted four kinds, all of them control functions —
-- verification, devils-advocate, compliance, risk. A peer examination is not one of
-- those. It is an analytical desk reading another desk's persisted claims and
-- saying, on the record, whether it agrees.
--
-- Migration 0034 already gave a challenge its mandate (`challenger_kind`). This
-- gives the REVIEW that carries it somewhere to live: without a kind of its own, a
-- peer examination would have to be stored as a Devil's Advocate review, and the
-- distinction 0034 was written to preserve would be destroyed one layer down.
--
-- ## Status is NULL, like the Devil's Advocate
--
-- `reviews_status_matches_kind` gives each kind its own verdict vocabulary so that
-- a compliance status can never appear on a risk review. Verification, compliance
-- and risk each reach a verdict about the work. The Devil's Advocate does not — its
-- output IS its challenges — and neither does a peer.
--
-- A peer examination's finding is the set of objections it filed, and **zero
-- objections is a real finding**: a desk that read the argument and had nothing to
-- contest has still examined it. That is why `recordPeerExamination` permits an
-- empty challenge set where `recordDevilsAdvocateReview` refuses one — the Devil's
-- Advocate has a standing obligation to object, a peer has an obligation to look.
--
-- The eligibility gates read that difference: PEER_SCRUTINY_ABSENT asks whether a
-- qualified peer examined the conclusion at all, and CHALLENGE_UNRESOLVED asks
-- whether the objections scrutiny produced were settled. A zero-challenge
-- examination satisfies the first without fabricating agreement for the second.

ALTER TABLE analysis.reviews
    DROP CONSTRAINT reviews_kind_known;

ALTER TABLE analysis.reviews
    ADD CONSTRAINT reviews_kind_known CHECK (
        kind IN ('verification', 'devils-advocate', 'compliance', 'risk',
                 'peer-examination')
    );

ALTER TABLE analysis.reviews
    DROP CONSTRAINT reviews_status_matches_kind;

ALTER TABLE analysis.reviews
    ADD CONSTRAINT reviews_status_matches_kind CHECK (
        (kind = 'verification' AND status IN (
            'verified', 'verified-with-qualifications', 'correction-required',
            'unresolved-discrepancy', 'insufficient-evidence', 'blocked'))
        OR (kind = 'compliance' AND status IN (
            'approved', 'changes-required', 'rejected'))
        OR (kind = 'risk' AND status IN (
            'accepted', 'accepted-with-limits', 'rejected'))
        OR (kind = 'devils-advocate' AND status IS NULL)
        -- A peer reports objections, not a verdict. See the note above.
        OR (kind = 'peer-examination' AND status IS NULL)
    );

-- WHO examined WHOM.
--
-- `by_department_id` already records the examiner. The examined desk cannot be
-- derived from the challenges, because a peer examination that raised no objection
-- has none — and that is precisely the case the eligibility basis must tell apart
-- from "nobody looked". So it is recorded rather than inferred.
--
-- Nullable, and constrained to the kind that uses it: a verification or risk review
-- examines the argument, not another department, and a value there would be
-- meaningless. Non-null exactly when the review is a peer examination.
ALTER TABLE analysis.reviews
    ADD COLUMN examined_department_id text REFERENCES analysis.departments (id);

ALTER TABLE analysis.reviews
    ADD CONSTRAINT reviews_examined_department_matches_kind CHECK (
        (kind = 'peer-examination' AND examined_department_id IS NOT NULL)
        OR (kind <> 'peer-examination' AND examined_department_id IS NULL)
    );

-- A desk cannot peer-examine itself. A department reviewing its own conclusion is
-- the thing peer scrutiny exists to be an alternative to.
ALTER TABLE analysis.reviews
    ADD CONSTRAINT reviews_peer_examines_another_department CHECK (
        kind <> 'peer-examination' OR examined_department_id <> by_department_id
    );

-- "Which desks examined this revision, and did any of them object" is the question
-- PEER_SCRUTINY_ABSENT asks on every eligibility evaluation.
CREATE INDEX reviews_peer_examination_idx
    ON analysis.reviews (revision_id, kind, by_department_id)
    WHERE kind = 'peer-examination';
