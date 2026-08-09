import { pure } from "../src/pure";
import { makeTestData } from "./helpers/makeTestData";
test("pure doubles", () => { expect(pure(2)).toBe(4); });
expect(makeTestData()).toEqual(["x"]);
