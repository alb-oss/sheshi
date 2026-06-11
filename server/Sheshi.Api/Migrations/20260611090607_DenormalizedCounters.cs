using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Sheshi.Api.Migrations
{
    /// <inheritdoc />
    public partial class DenormalizedCounters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LatestActivityAt",
                table: "Rooms",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ThreadCount",
                table: "Rooms",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ReplyCount",
                table: "Messages",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "VoteCount",
                table: "Messages",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Backfill the new counters from existing rows.
            migrationBuilder.Sql(
                "UPDATE \"Messages\" p SET \"ReplyCount\" = " +
                "(SELECT COUNT(*) FROM \"Messages\" c WHERE c.\"ParentId\" = p.\"Id\" AND c.\"DeletedAt\" IS NULL);");
            migrationBuilder.Sql(
                "UPDATE \"Messages\" m SET \"VoteCount\" = " +
                "(SELECT COUNT(*) FROM \"Votes\" v WHERE v.\"MessageId\" = m.\"Id\");");
            migrationBuilder.Sql(
                "UPDATE \"Rooms\" r SET " +
                "\"ThreadCount\" = (SELECT COUNT(*) FROM \"Messages\" m WHERE m.\"RoomId\" = r.\"Id\" AND m.\"ParentId\" IS NULL AND m.\"DeletedAt\" IS NULL), " +
                "\"LatestActivityAt\" = (SELECT MAX(m.\"CreatedAt\") FROM \"Messages\" m WHERE m.\"RoomId\" = r.\"Id\");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LatestActivityAt",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "ThreadCount",
                table: "Rooms");

            migrationBuilder.DropColumn(
                name: "ReplyCount",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "VoteCount",
                table: "Messages");
        }
    }
}
