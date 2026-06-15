using FluentAssertions;
using Sheshi.Api.Features.Users;

namespace Sheshi.Api.Tests;

public class KarmaCurveTests
{
    [Theory]
    [InlineData(-5, 0)] // downvoted → never negative
    [InlineData(0, 0)] // no net upvotes from others → nothing
    [InlineData(1, 1)] // threshold met
    [InlineData(5, 5)] // 1:1 below the knee
    [InlineData(10, 10)] // at the knee
    [InlineData(11, 11)] // 10 + floor(sqrt(1))
    [InlineData(14, 12)] // 10 + floor(sqrt(4))
    [InlineData(19, 13)] // 10 + floor(sqrt(9))
    [InlineData(110, 20)] // 10 + floor(sqrt(100))
    [InlineData(1010, 41)] // 10 + floor(sqrt(1000)) — a viral post can't mint karma
    public void Message_is_one_to_one_up_to_the_knee_then_dampened(int netFromOthers, int expected)
        => KarmaCurve.Message(netFromOthers).Should().Be(expected);

    [Fact]
    public void Total_sums_per_message_and_floors_at_zero()
    {
        KarmaCurve.Total([1, 5, 0, -3]).Should().Be(6); // 1 + 5 + 0 + 0
        KarmaCurve.Total([]).Should().Be(0);
    }
}
