using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Sheshi.Api.Migrations
{
    /// <inheritdoc />
    public partial class ThreadMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Messages_RoomId_CreatedAt",
                table: "Messages");

            migrationBuilder.AddColumn<int>(
                name: "Depth",
                table: "Messages",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "RootMessageId",
                table: "Messages",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.Sql("""
                WITH RECURSIVE thread_tree AS (
                    SELECT "Id", "Id" AS "RootMessageId", 0 AS "Depth"
                    FROM "Messages"
                    WHERE "ParentId" IS NULL

                    UNION ALL

                    SELECT child."Id", thread_tree."RootMessageId", thread_tree."Depth" + 1 AS "Depth"
                    FROM "Messages" child
                    INNER JOIN thread_tree ON child."ParentId" = thread_tree."Id"
                )
                UPDATE "Messages" message
                SET "RootMessageId" = thread_tree."RootMessageId",
                    "Depth" = thread_tree."Depth"
                FROM thread_tree
                WHERE message."Id" = thread_tree."Id";

                UPDATE "Messages"
                SET "RootMessageId" = "Id",
                    "Depth" = 0
                WHERE "RootMessageId" = '00000000-0000-0000-0000-000000000000';
                """);

            migrationBuilder.CreateIndex(
                name: "IX_Messages_RoomId_CreatedAt_Id",
                table: "Messages",
                columns: new[] { "RoomId", "CreatedAt", "Id" },
                descending: new[] { false, true, true },
                filter: "\"ParentId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Messages_RootMessageId_CreatedAt_Id",
                table: "Messages",
                columns: new[] { "RootMessageId", "CreatedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Messages_RoomId_CreatedAt_Id",
                table: "Messages");

            migrationBuilder.DropIndex(
                name: "IX_Messages_RootMessageId_CreatedAt_Id",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "Depth",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "RootMessageId",
                table: "Messages");

            migrationBuilder.CreateIndex(
                name: "IX_Messages_RoomId_CreatedAt",
                table: "Messages",
                columns: new[] { "RoomId", "CreatedAt" },
                descending: new[] { false, true },
                filter: "\"ParentId\" IS NULL");
        }
    }
}
