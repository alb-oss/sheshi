using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Sheshi.Api.Migrations
{
    /// <inheritdoc />
    public partial class DailyStatsRollup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DailyStats",
                columns: table => new
                {
                    Date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NewUsers = table.Column<int>(type: "integer", nullable: false),
                    Messages = table.Column<int>(type: "integer", nullable: false),
                    Votes = table.Column<int>(type: "integer", nullable: false),
                    Reports = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyStats", x => x.Date);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyStats");
        }
    }
}
