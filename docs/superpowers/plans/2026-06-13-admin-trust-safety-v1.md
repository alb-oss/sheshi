# Admin Trust Safety V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-grade trust and safety admin workflow: visible reporting, action logging, filtered inbox, deterministic auto-flags, and dashboard metrics.

**Architecture:** Keep the existing .NET API and React/TanStack frontend. Add focused moderation domain types and services under `server/Sheshi.Api/Features/Moderation`, then update `/moderim` in small UI slices. The rule engine is deterministic-first and provider-ready, with no automatic punitive enforcement in V1.

**Tech Stack:** ASP.NET Core 10, EF Core, PostgreSQL, xUnit, FluentAssertions, React 19, TanStack Router, Vite, shadcn-style local components.

---

## File Structure

- Modify `src/components/MessageCard.tsx`: make report action visible on mobile/touch while preserving compact desktop behavior.
- Modify `src/routes/moderim.tsx`: evolve from two simple tabs into reports, users, metrics, flags, and action log sections.
- Modify `src/lib/sheshi.ts`: add typed client helpers for moderation filters, metrics, flags, and actions if the UI becomes too noisy.
- Modify `server/Sheshi.Api/Domain/Report.cs`: add report source, severity, room, and resolution metadata.
- Create `server/Sheshi.Api/Domain/ModerationAction.cs`: append-only audit event.
- Create `server/Sheshi.Api/Domain/ModerationFlag.cs`: automated flag record.
- Modify `server/Sheshi.Api/Domain/Enums.cs`: add moderation source, severity, flag status, and action type enums.
- Modify `server/Sheshi.Api/Data/AppDbContext.cs`: add DbSets and indexes.
- Add EF migration under `server/Sheshi.Api/Migrations/`.
- Create `server/Sheshi.Api/Features/Moderation/ModerationActionLogger.cs`: single place to write action log entries.
- Create `server/Sheshi.Api/Features/Moderation/ModerationRuleEngine.cs`: deterministic checks for spam and doxxing.
- Create `server/Sheshi.Api/Features/Moderation/ContentClassifier.cs`: no-op provider interface and result types.
- Create `server/Sheshi.Api/Features/Moderation/ModerationMetricsService.cs`: query metrics for dashboard.
- Modify `server/Sheshi.Api/Features/Moderation/ModerationController.cs`: filtered reports, flags, action log, metrics endpoints.
- Modify `server/Sheshi.Api/Features/Messages/MessagesController.cs`: call rule engine after message creation; log moderation deletes.
- Modify `server/Sheshi.Api/Features/Rooms/RoomsController.cs`: log room creation.
- Modify `server/Sheshi.Api/Program.cs`: register new services.
- Modify `server/Sheshi.Api.Tests/RealtimeStorageModerationTests.cs`: extend moderation contract tests.
- Create `server/Sheshi.Api.Tests/ModerationRuleEngineTests.cs`: deterministic rule tests.
- Create `server/Sheshi.Api.Tests/ModerationMetricsTests.cs`: metrics endpoint tests.

---

### Task 1: Mobile Report Visibility and Empty State

**Files:**

- Modify: `src/components/MessageCard.tsx`
- Modify: `src/routes/moderim.tsx`

- [ ] **Step 1: Confirm current bug**

Run:

```bash
npm run legacy:dev -- --host 0.0.0.0
```

Open `http://127.0.0.1:8080/` in a mobile viewport. Expected before fix: report flag is unavailable unless hover state is simulated.

- [ ] **Step 2: Make report action visible on touch devices**

Change the report button class in `src/components/MessageCard.tsx` from:

```tsx
className =
  "text-foreground/30 hover:text-primary transition-colors opacity-0 group-hover:opacity-100";
```

to:

```tsx
className =
  "text-foreground/40 hover:text-primary transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100";
```

Keep the button gated by `currentUserId && !isOwn`.

- [ ] **Step 3: Improve the empty report state**

Change the empty state text in `src/routes/moderim.tsx` from only:

```tsx
Nuk ka raporte të hapura.
```

to a compact explanation:

```tsx
Nuk ka raporte të hapura. Raportet krijohen kur një përdorues i kyçur shtyp flamurin te një mesazh i dikujt tjetër.
```

- [ ] **Step 4: Verify browser behavior**

Run the app and check:

```bash
curl -sS -I http://127.0.0.1:8080/ | head -5
```

Expected: `HTTP/1.1 200`.

In the browser:

- Desktop: report flag may remain subtle until card hover.
- Mobile viewport: report flag is visible for other users' messages.
- Own messages still show delete, not report.

- [ ] **Step 5: Commit**

```bash
git add src/components/MessageCard.tsx src/routes/moderim.tsx
git commit -m "fix: make reports reachable on mobile"
```

---

### Task 2: Moderation Action Log Foundation

**Files:**

- Modify: `server/Sheshi.Api/Domain/Enums.cs`
- Create: `server/Sheshi.Api/Domain/ModerationAction.cs`
- Modify: `server/Sheshi.Api/Data/AppDbContext.cs`
- Create: `server/Sheshi.Api/Features/Moderation/ModerationActionLogger.cs`
- Modify: `server/Sheshi.Api/Features/Moderation/ModerationController.cs`
- Modify: `server/Sheshi.Api/Features/Messages/MessagesController.cs`
- Modify: `server/Sheshi.Api/Features/Rooms/RoomsController.cs`
- Modify: `server/Sheshi.Api/Program.cs`
- Test: `server/Sheshi.Api.Tests/RealtimeStorageModerationTests.cs`

- [ ] **Step 1: Write failing action-log test**

Add assertions to `Moderation_endpoints_enforce_roles_and_apply_actions` after resolving the report, banning the user, and granting moderator role:

```csharp
UseBearer(client, admin.AccessToken);
var actionsResponse = await client.GetAsync("/api/mod/actions");
actionsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
var actions = await actionsResponse.Content.ReadFromJsonAsync<ModActionDto[]>();
actions.Should().NotBeNull();
actions!.Select(a => a.ActionType).Should().Contain(["report_resolved", "user_banned", "role_granted"]);
```

Add local DTO:

```csharp
private sealed record ModActionDto(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("actor_id")] Guid ActorId,
    [property: JsonPropertyName("action_type")] string ActionType,
    [property: JsonPropertyName("target_type")] string TargetType,
    [property: JsonPropertyName("target_id")] Guid TargetId,
    [property: JsonPropertyName("reason")] string? Reason,
    [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt);
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter Moderation_endpoints_enforce_roles_and_apply_actions
```

Expected: FAIL because `/api/mod/actions` does not exist.

- [ ] **Step 3: Add action enum constants**

In `server/Sheshi.Api/Domain/Enums.cs`, add:

```csharp
public static class ModerationActionTypes
{
    public const string ReportResolved = "report_resolved";
    public const string ReportDismissed = "report_dismissed";
    public const string MessageDeleted = "message_deleted";
    public const string UserBanned = "user_banned";
    public const string UserUnbanned = "user_unbanned";
    public const string RoleGranted = "role_granted";
    public const string RoleRemoved = "role_removed";
    public const string RoomCreated = "room_created";
}
```

- [ ] **Step 4: Add entity**

Create `server/Sheshi.Api/Domain/ModerationAction.cs`:

```csharp
namespace Sheshi.Api.Domain;

public class ModerationAction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ActorId { get; set; }
    public string ActionType { get; set; } = "";
    public string TargetType { get; set; } = "";
    public Guid TargetId { get; set; }
    public string? Reason { get; set; }
    public string? MetadataJson { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
```

- [ ] **Step 5: Register DbSet and index**

In `AppDbContext`, add:

```csharp
public DbSet<ModerationAction> ModerationActions => Set<ModerationAction>();
```

Inside `OnModelCreating`, add:

```csharp
builder.Entity<ModerationAction>(entity =>
{
    entity.HasIndex(a => a.CreatedAt);
    entity.HasIndex(a => new { a.TargetType, a.TargetId });
    entity.Property(a => a.ActionType).HasMaxLength(80);
    entity.Property(a => a.TargetType).HasMaxLength(80);
    entity.Property(a => a.Reason).HasMaxLength(500);
});
```

- [ ] **Step 6: Add logger service**

Create `server/Sheshi.Api/Features/Moderation/ModerationActionLogger.cs`:

```csharp
using System.Security.Claims;
using Sheshi.Api.Data;
using Sheshi.Api.Domain;

namespace Sheshi.Api.Features.Moderation;

public class ModerationActionLogger(AppDbContext db)
{
    public async Task LogAsync(
        ClaimsPrincipal actor,
        string actionType,
        string targetType,
        Guid targetId,
        string? reason = null,
        string? metadataJson = null,
        CancellationToken ct = default)
    {
        var actorIdRaw = actor.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(actorIdRaw, out var actorId)) return;

        db.ModerationActions.Add(new ModerationAction
        {
            ActorId = actorId,
            ActionType = actionType,
            TargetType = targetType,
            TargetId = targetId,
            Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim()[..Math.Min(reason.Trim().Length, 500)],
            MetadataJson = metadataJson
        });
        await db.SaveChangesAsync(ct);
    }
}
```

- [ ] **Step 7: Register service**

In `Program.cs`, add:

```csharp
builder.Services.AddScoped<ModerationActionLogger>();
```

- [ ] **Step 8: Add action DTO and endpoint**

In `ModerationDtos.cs`, add:

```csharp
public record ModActionDto(
    Guid Id,
    Guid ActorId,
    string ActionType,
    string TargetType,
    Guid TargetId,
    string? Reason,
    DateTimeOffset CreatedAt);
```

In `ModerationController`, add constructor dependency `ModerationActionLogger actionLogger` and endpoint:

```csharp
[HttpGet("actions")]
public async Task<ActionResult<IReadOnlyList<ModActionDto>>> Actions(CancellationToken ct = default)
{
    var actions = await db.ModerationActions
        .AsNoTracking()
        .OrderByDescending(a => a.CreatedAt)
        .Take(100)
        .Select(a => new ModActionDto(a.Id, a.ActorId, a.ActionType, a.TargetType, a.TargetId, a.Reason, a.CreatedAt))
        .ToListAsync(ct);

    return Ok(actions);
}
```

- [ ] **Step 9: Log existing moderation mutations**

In report resolve/dismiss, ban/unban, and role update paths, call `actionLogger.LogAsync(...)` after the mutation succeeds.

Use target types:

```csharp
"report"
"user"
"role"
```

Use action types from `ModerationActionTypes`.

- [ ] **Step 10: Add EF migration**

Run:

```bash
dotnet ef migrations add AddModerationActions --project server/Sheshi.Api/Sheshi.Api.csproj --startup-project server/Sheshi.Api/Sheshi.Api.csproj
```

Expected: migration creates `ModerationActions`.

- [ ] **Step 11: Run tests**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter Moderation
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add server/Sheshi.Api server/Sheshi.Api.Tests
git commit -m "feat: add moderation action log"
```

---

### Task 3: Report Inbox V2 Filters

**Files:**

- Modify: `server/Sheshi.Api/Domain/Report.cs`
- Modify: `server/Sheshi.Api/Domain/Enums.cs`
- Modify: `server/Sheshi.Api/Features/Moderation/ModerationDtos.cs`
- Modify: `server/Sheshi.Api/Features/Moderation/ModerationController.cs`
- Modify: `src/routes/moderim.tsx`
- Test: `server/Sheshi.Api.Tests/RealtimeStorageModerationTests.cs`

- [ ] **Step 1: Extend report DTO contract test**

Add a test that creates reports with two reasons and then calls:

```csharp
var filtered = await client.GetAsync("/api/mod/reports?status=open&reason=hate");
filtered.StatusCode.Should().Be(HttpStatusCode.OK);
var rows = await filtered.Content.ReadFromJsonAsync<ModReportDto[]>();
rows.Should().NotBeNull();
rows!.Should().OnlyContain(r => r.Reason == "hate");
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter Moderation
```

Expected: FAIL because reason filtering is not implemented.

- [ ] **Step 3: Add query DTO**

In `ModerationDtos.cs`, add:

```csharp
public record ReportQuery(
    string Status = "open",
    string? Reason = null,
    string? RoomId = null,
    string? Source = null,
    string? Severity = null,
    int Limit = 50);
```

- [ ] **Step 4: Apply filters in controller**

Change `Reports([FromQuery] string status = "open"...` to:

```csharp
public async Task<ActionResult<IReadOnlyList<ModReportDto>>> Reports([FromQuery] ReportQuery query, CancellationToken ct = default)
```

Build an `IQueryable<Report>` and apply parsed filters before projection.

- [ ] **Step 5: Update UI filter state**

In `src/routes/moderim.tsx`, add local state for:

```tsx
const [status, setStatusFilter] = useState("open");
const [reason, setReason] = useState("all");
```

Build request:

```tsx
const params = new URLSearchParams({ status });
if (reason !== "all") params.set("reason", reason);
apiJson<ModReport[]>(`/api/mod/reports?${params.toString()}`);
```

- [ ] **Step 6: Run tests and browser check**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter Moderation
```

Expected: PASS.

Browser: `/moderim` filters should reload reports without full page navigation.

- [ ] **Step 7: Commit**

```bash
git add server/Sheshi.Api server/Sheshi.Api.Tests src/routes/moderim.tsx
git commit -m "feat: add report inbox filters"
```

---

### Task 4: Deterministic Moderation Flags

**Files:**

- Modify: `server/Sheshi.Api/Domain/Enums.cs`
- Create: `server/Sheshi.Api/Domain/ModerationFlag.cs`
- Modify: `server/Sheshi.Api/Data/AppDbContext.cs`
- Create: `server/Sheshi.Api/Features/Moderation/ModerationRuleEngine.cs`
- Modify: `server/Sheshi.Api/Features/Messages/MessagesController.cs`
- Modify: `server/Sheshi.Api/Features/Moderation/ModerationController.cs`
- Test: `server/Sheshi.Api.Tests/ModerationRuleEngineTests.cs`

- [ ] **Step 1: Write doxxing and spam tests**

Create `ModerationRuleEngineTests.cs` with tests asserting:

```csharp
flags.Should().Contain(f => f.RuleKey == "doxxing.email" && f.Severity == "high");
flags.Should().Contain(f => f.RuleKey == "spam.duplicate_text");
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter ModerationRuleEngine
```

Expected: FAIL because rule engine does not exist.

- [ ] **Step 3: Add `ModerationFlag` entity**

Create entity with message, room, author, rule key, category, severity, score, evidence, status, and timestamps.

- [ ] **Step 4: Implement rule engine**

Rules:

```csharp
private static readonly Regex EmailRegex = new(@"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", RegexOptions.IgnoreCase | RegexOptions.Compiled);
private static readonly Regex PhoneRegex = new(@"\b(?:\+?\d[\s.-]?){7,15}\b", RegexOptions.Compiled);
private static readonly Regex LinkRegex = new(@"https?://|www\.", RegexOptions.IgnoreCase | RegexOptions.Compiled);
```

Use recent author message queries for duplicate and burst checks.

- [ ] **Step 5: Call rule engine after message save**

In `PostMessage`, after saving the message and before returning response:

```csharp
await moderationRuleEngine.EvaluateAsync(message, ct);
```

- [ ] **Step 6: Add flag list endpoint**

Expose:

```http
GET /api/mod/flags?status=open
POST /api/mod/flags/{id}/resolve
POST /api/mod/flags/{id}/dismiss
```

- [ ] **Step 7: Add EF migration**

Run:

```bash
dotnet ef migrations add AddModerationFlags --project server/Sheshi.Api/Sheshi.Api.csproj --startup-project server/Sheshi.Api/Sheshi.Api.csproj
```

- [ ] **Step 8: Run tests**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter Moderation
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/Sheshi.Api server/Sheshi.Api.Tests
git commit -m "feat: add deterministic moderation flags"
```

---

### Task 5: Metrics Dashboard

**Files:**

- Create: `server/Sheshi.Api/Features/Moderation/ModerationMetricsService.cs`
- Modify: `server/Sheshi.Api/Features/Moderation/ModerationDtos.cs`
- Modify: `server/Sheshi.Api/Features/Moderation/ModerationController.cs`
- Modify: `src/routes/moderim.tsx`
- Test: `server/Sheshi.Api.Tests/ModerationMetricsTests.cs`

- [ ] **Step 1: Write metrics endpoint test**

Create a test that creates one open report, one resolved report, one ban action, and one deleted message action. Assert:

```csharp
metrics.OpenReports.Should().Be(1);
metrics.ResolvedReports7d.Should().Be(1);
metrics.Bans7d.Should().Be(1);
metrics.DeletedMessages7d.Should().Be(1);
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter ModerationMetrics
```

Expected: FAIL because `/api/mod/metrics` does not exist.

- [ ] **Step 3: Add DTO**

In `ModerationDtos.cs`, add:

```csharp
public record ModerationMetricsDto(
    int OpenReports,
    int OpenFlags,
    double? AverageResolutionHours7d,
    double? OldestOpenItemHours,
    int Bans7d,
    int DeletedMessages7d,
    IReadOnlyList<MetricBucketDto> ReportsByReason,
    IReadOnlyList<MetricBucketDto> FlagsByRule);

public record MetricBucketDto(string Key, int Count);
```

- [ ] **Step 4: Implement service**

`ModerationMetricsService.GetAsync` queries reports, flags, and moderation actions with no client-side aggregation.

- [ ] **Step 5: Expose endpoint**

Add:

```csharp
[HttpGet("metrics")]
public async Task<ActionResult<ModerationMetricsDto>> Metrics(CancellationToken ct = default) =>
    Ok(await metrics.GetAsync(ct));
```

- [ ] **Step 6: Add UI cards**

In `/moderim`, add a `MetricsPanel` tab with cards for open reports, open flags, average resolution time, oldest open item, bans 7d, and deleted posts 7d.

- [ ] **Step 7: Run tests and browser check**

Run:

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter Moderation
```

Expected: PASS.

Browser: `/moderim` metrics tab renders without console errors.

- [ ] **Step 8: Commit**

```bash
git add server/Sheshi.Api server/Sheshi.Api.Tests src/routes/moderim.tsx
git commit -m "feat: add moderation metrics dashboard"
```

---

### Task 6: Optional Classifier Interface

**Files:**

- Create: `server/Sheshi.Api/Features/Moderation/IContentClassifier.cs`
- Create: `server/Sheshi.Api/Features/Moderation/NoopContentClassifier.cs`
- Modify: `server/Sheshi.Api/Features/Moderation/ModerationRuleEngine.cs`
- Modify: `server/Sheshi.Api/Program.cs`
- Test: `server/Sheshi.Api.Tests/ModerationRuleEngineTests.cs`

- [ ] **Step 1: Write no-op classifier test**

Assert that classifier-disabled content creates no classifier flags but deterministic flags still work.

- [ ] **Step 2: Add interface**

```csharp
public interface IContentClassifier
{
    Task<IReadOnlyList<ContentClassificationResult>> ClassifyAsync(string text, CancellationToken ct = default);
}

public record ContentClassificationResult(string Category, string Severity, double Score, string Evidence);
```

- [ ] **Step 3: Add no-op implementation**

```csharp
public class NoopContentClassifier : IContentClassifier
{
    public Task<IReadOnlyList<ContentClassificationResult>> ClassifyAsync(string text, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<ContentClassificationResult>>([]);
}
```

- [ ] **Step 4: Register no-op provider**

```csharp
builder.Services.AddScoped<IContentClassifier, NoopContentClassifier>();
```

- [ ] **Step 5: Wire classifier into rule engine**

The rule engine appends classifier results to deterministic flags. It treats classifier output as queueing evidence only.

- [ ] **Step 6: Run tests**

```bash
dotnet test server/Sheshi.Api.Tests/Sheshi.Api.Tests.csproj --filter ModerationRuleEngine
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/Sheshi.Api server/Sheshi.Api.Tests
git commit -m "feat: add moderation classifier interface"
```

---

## Self-Review

- Spec coverage: mobile report visibility, action log, inbox filters, deterministic auto-flags, metrics dashboard, and classifier interface are covered.
- Placeholder scan: no task depends on undefined future behavior.
- Type consistency: action type constants, moderation entities, DTO names, and endpoint names stay consistent across tasks.
- Scope control: appeals, identity reveal, image moderation, and automatic hard enforcement remain out of V1.
