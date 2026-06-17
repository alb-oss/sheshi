/** Pure vote math used by VoteControl's optimistic updates. */
import { formatScore, nextVote, optimisticScore } from "../voteLogic";

describe("nextVote (toggle semantics)", () => {
  it("sets the tapped direction from neutral", () => {
    expect(nextVote(0, 1)).toBe(1);
    expect(nextVote(0, -1)).toBe(-1);
  });

  it("clears the vote when re-tapping the held direction", () => {
    expect(nextVote(1, 1)).toBe(0);
    expect(nextVote(-1, -1)).toBe(0);
  });

  it("switches sides when tapping the opposite direction", () => {
    expect(nextVote(-1, 1)).toBe(1);
    expect(nextVote(1, -1)).toBe(-1);
  });
});

describe("optimisticScore", () => {
  it("upvoting from neutral adds one", () => {
    expect(optimisticScore(10, 0, 1)).toBe(11);
  });

  it("clearing an upvote removes one", () => {
    expect(optimisticScore(11, 1, 0)).toBe(10);
  });

  it("flipping downvote to upvote swings by two", () => {
    expect(optimisticScore(5, -1, 1)).toBe(7);
  });

  it("flipping upvote to downvote swings by two", () => {
    expect(optimisticScore(5, 1, -1)).toBe(3);
  });
});

describe("formatScore", () => {
  it("shows plain integers below 1000 (including negatives)", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(42)).toBe("42");
    expect(formatScore(-7)).toBe("-7");
    expect(formatScore(999)).toBe("999");
  });

  it("compacts thousands and trims a trailing .0", () => {
    expect(formatScore(1000)).toBe("1k");
    expect(formatScore(1200)).toBe("1.2k");
    expect(formatScore(15000)).toBe("15k");
    expect(formatScore(-2500)).toBe("-2.5k");
  });
});
