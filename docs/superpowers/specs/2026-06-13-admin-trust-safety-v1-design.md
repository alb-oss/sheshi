# Admin Trust Safety V1 Design

## Goal

Build a senior-grade moderation surface for Sheshi that makes reporting visible, gives admins a serious report inbox, records every privileged action, flags likely abuse automatically, and exposes operational metrics without weakening user anonymity.

## Current State

Reports already exist end to end:

- Frontend report action: `src/components/MessageCard.tsx`
- Report dialog: `src/components/ReportDialog.tsx`
- Report creation API: `server/Sheshi.Api/Features/Messages/MessagesController.cs`
- Moderation inbox API: `server/Sheshi.Api/Features/Moderation/ModerationController.cs`
- Moderation UI: `src/routes/moderim.tsx`

The live local database currently has zero reports. The frontend report action is hard to discover because it is hover-only and only shown to logged-in users on messages they did not author. Mobile users cannot reliably discover it because touch devices do not have hover.

## Product Principles

1. Reports must be easy to create on mobile and desktop.
2. Automation should prioritize and route cases before it punishes users.
3. Admin and moderator actions must be auditable.
4. Moderator views should reveal the least identity data required.
5. Metrics must help operate the queue, not become vanity charts.
6. The first version should be deterministic where possible and optional-provider where machine scoring is needed.

These principles follow established trust and safety guidance: moderation is normally a mix of people and automation, quality must be monitored for false positives and false negatives, audit logs must be protected from tampering, and automated moderation needs transparency and human review for uncertain cases.

## Scope

### In Scope

- Mobile-visible report action.
- Better empty state for the current report inbox.
- Report inbox filters by status, reason, room, severity, source, and age.
- Deterministic auto-flags for spam and doxxing-like patterns.
- Optional classifier hook for hate, harassment, and violence scores.
- Dashboard metrics for open reports, average resolution time, bans, deleted posts, auto-flags, and queue age.
- Append-only moderation action log.
- Tests for backend contracts and core rule behavior.

### Out of Scope for V1

- Appeals queue.
- Full policy CMS.
- Fully anonymous identity reveal workflow.
- Paid third-party moderation provider integration.
- Image moderation beyond uploaded-image metadata and reportability.
- Automated permanent bans.

## Architecture

Add a small `Features/Moderation` domain layer that owns moderation-specific data and behavior:

- `ModerationAction` records privileged events.
- `ModerationFlag` records automated flags and rule evidence.
- `ModerationRuleEngine` runs deterministic checks against new messages.
- `ModerationMetricsService` aggregates queue and action metrics.
- `ModerationController` exposes filtered inbox, action log, metrics, and flag review endpoints.

`MessagesController.PostMessage` remains the write path for user content. After a message is saved, it calls the moderation rule engine. Flags can create or augment review items, but V1 does not auto-delete user content unless a future explicit policy enables that.

## Data Model

### Report changes

Add fields to `Report`:

- `Source`: `user` or `auto`
- `Severity`: `low`, `medium`, `high`, `critical`
- `RoomId`
- `ResolvedById`
- `ResolvedAt`
- `ResolutionNote`

`RoomId` is denormalized for fast filtering. Existing reports can backfill `RoomId` from `Message.RoomId`, `Source=user`, and `Severity=medium`.

### New ModerationFlag

Fields:

- `Id`
- `MessageId`
- `RoomId`
- `AuthorId`
- `RuleKey`
- `Category`: `spam`, `hate`, `doxxing`, `violence`, `harassment`, `other`
- `Severity`
- `Score`
- `Evidence`
- `Status`: `open`, `resolved`, `dismissed`
- `CreatedAt`
- `ResolvedById`
- `ResolvedAt`

Evidence must be short and sanitized. For doxxing, store the type of PII found and a redacted snippet, not raw private data.

### New ModerationAction

Fields:

- `Id`
- `ActorId`
- `ActionType`
- `TargetType`
- `TargetId`
- `Reason`
- `MetadataJson`
- `CreatedAt`

The table is append-only at application level. No update or delete endpoints are exposed.

## Rule Engine

V1 deterministic rules:

- `spam.duplicate_text`: same author posts same normalized body repeatedly in a short window.
- `spam.link_burst`: same author posts multiple link-heavy messages in a short window.
- `spam.too_many_messages`: same author exceeds message count threshold in a short window.
- `doxxing.email`: body contains email-like value.
- `doxxing.phone`: body contains phone-like value.
- `doxxing.address_hint`: body contains address-like number and street term.

V1 optional classifier interface:

- `IContentClassifier.ClassifyAsync(text)` returns category scores.
- Default implementation is disabled/no-op.
- Future provider can map OpenAI moderation categories or another provider into Sheshi categories.

Classifier output only creates `ModerationFlag` rows. It does not remove content automatically in V1.

## Admin Experience

### Report Inbox V2

Columns:

- Severity
- Reason/category
- Message excerpt
- Room
- Age
- Source: user or auto
- Reporter count
- Author history summary
- Actions: resolve, dismiss, delete message, ban user

Filters:

- Status
- Reason/category
- Severity
- Source
- Room
- Age bucket
- Has repeat author

### Action Log

Show recent privileged events:

- Report resolved/dismissed
- Message deleted
- User banned/unbanned
- Role granted/removed
- Flag resolved/dismissed

Rows include actor, action, target, reason, and timestamp.

### Metrics Dashboard

Cards:

- Open reports
- Open auto-flags
- Average resolution time
- Oldest open item age
- Bans in last 7 days
- Deleted posts in last 7 days

Breakdowns:

- Reports by reason
- Flags by rule
- Queue by severity
- Actions by day

## Permissions

- Moderator can view reports, filters, flags, metrics, and action log.
- Moderator can resolve/dismiss reports, delete messages, ban/unban users.
- Admin can do everything moderator can do.
- Admin alone can grant/remove moderator role and create rooms.
- Future identity reveal must be admin-only and action-logged.

## Testing

Backend:

- Report creation still works.
- Report filters return expected rows.
- Moderation actions are written for every privileged mutation.
- Rule engine creates expected flags for deterministic spam and doxxing samples.
- Metrics endpoint aggregates from reports, flags, bans, and deletes.
- Authorization rules stay enforced.

Frontend:

- Mobile report button is visible/reachable.
- Report inbox filters request correct query parameters.
- Empty report state explains how reports are created.
- Metrics cards render from API response.

## Rollout Order

1. Fix mobile report visibility and improve report empty state.
2. Add action log infrastructure and wire existing moderation actions.
3. Add Report Inbox V2 filters and backend query contract.
4. Add deterministic moderation flags.
5. Add metrics dashboard.
6. Add optional classifier provider interface.

## References

- TSPA: content moderation can be manual, automated, or hybrid depending on abuse scale and operational maturity.
- TSPA QA: moderation quality must monitor false positives, false negatives, wrong selections, and technical errors.
- OWASP Logging: log data must be protected from tampering, unauthorized access, modification, and deletion.
- Santa Clara Principles: automated moderation should be high-confidence, explainable, and paired with due process.
- OpenAI Moderation categories: useful mapping for hate, harassment, self-harm, sexual, and violence classes.
- Microsoft Presidio: useful reference pattern for PII detection and redaction.
