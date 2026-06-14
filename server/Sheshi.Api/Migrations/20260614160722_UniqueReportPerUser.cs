using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Sheshi.Api.Migrations
{
    /// <inheritdoc />
    public partial class UniqueReportPerUser : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Reports_MessageId",
                table: "Reports");

            // Collapse any pre-existing duplicate reports (same reporter + message) to the earliest
            // one so the new unique index can be created on existing data.
            migrationBuilder.Sql(@"
                DELETE FROM ""Reports"" r
                WHERE r.""Id"" IN (
                    SELECT ""Id"" FROM (
                        SELECT ""Id"", ROW_NUMBER() OVER (
                            PARTITION BY ""MessageId"", ""ReporterId"" ORDER BY ""CreatedAt"", ""Id""
                        ) AS rn
                        FROM ""Reports""
                    ) t WHERE t.rn > 1
                );");

            migrationBuilder.CreateIndex(
                name: "IX_Reports_MessageId_ReporterId",
                table: "Reports",
                columns: new[] { "MessageId", "ReporterId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Reports_MessageId_ReporterId",
                table: "Reports");

            migrationBuilder.CreateIndex(
                name: "IX_Reports_MessageId",
                table: "Reports",
                column: "MessageId");
        }
    }
}
