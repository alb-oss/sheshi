using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Sheshi.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVoteValue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<short>(
                name: "Value",
                table: "Votes",
                type: "smallint",
                nullable: false,
                defaultValue: (short)1);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Votes_Value",
                table: "Votes",
                sql: "\"Value\" IN (-1, 1)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Votes_Value",
                table: "Votes");

            migrationBuilder.DropColumn(
                name: "Value",
                table: "Votes");
        }
    }
}
