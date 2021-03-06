import { DEngineClientV2 } from "@dendronhq/common-all";
import {
  AssertUtils,
  ENGINE_HOOKS,
  ENGINE_SERVER,
  runEngineTestV4,
  TestPresetEntryV4,
} from "@dendronhq/common-test-utils";
import { DendronASTData, DendronASTDest } from "../../types";
import { MDUtilsV4 } from "../../utils";
import { dendronPub } from "../dendronPub";
import { noteRefs, NoteRefsOpts } from "../noteRefs";
import { createEngine, createProcTests } from "./utils";

function proc(
  engine: DEngineClientV2,
  dendron: DendronASTData,
  opts?: NoteRefsOpts
) {
  return MDUtilsV4.proc({ engine })
    .data("dendron", dendron)
    .use(noteRefs, opts);
}

describe("parse", () => {
  let engine: any;
  let dest: DendronASTDest.MD_REGULAR;

  test("init", () => {
    const resp = proc(engine, { dest }).parse(`((ref: [[foo.md]]))`);
    expect(resp).toMatchSnapshot();
    // @ts-ignore
    expect(resp.children[0].children[0].type).toEqual("refLink");
  });

  test("init with inject", async () => {
    await runEngineTestV4(
      async ({ engine, vaults }) => {
        let _proc = proc(engine, { dest, vault: vaults[0] }).use(dendronPub);
        const resp = _proc.parse(`((ref: [[foo.md]]))`);
        expect(resp).toMatchSnapshot();
        const resp2 = _proc.runSync(resp);
        expect(resp2).toMatchSnapshot();
        return;
      },
      {
        expect,
        createEngine,
        preSetupHook: ENGINE_HOOKS.setupBasic,
      }
    );
  });

  test("doesn't parse inline code block", () => {
    const resp = proc(engine, { dest }).parse("`((ref: [[foo.md]]))`");
    expect(resp).toMatchSnapshot("bond");
    // @ts-ignore
    expect(resp.children[0].children[0].type).toEqual("inlineCode");
  });
});

// future
// type TestCase<TData, TExpected> = {
//   testCase: string;
//   data: TData;
//   expected: TExpected;
// };

describe("compilev2", () => {
  const linkWithNoExtension = "((ref:[[foo]]))";

  const REGULAR_CASE = createProcTests({
    name: "regular",
    setupFunc: async ({ engine, vaults, extra }) => {
      const proc2 = await MDUtilsV4.procFull({
        engine,
        wikiLinksOpts: { useId: true },
        dest: extra.dest,
        vault: vaults[0],
      });
      const resp = await proc2.process(linkWithNoExtension);
      return { resp, proc };
    },
    verifyFuncDict: {
      [DendronASTDest.MD_DENDRON]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        expect(
          await AssertUtils.assertInString({
            body: resp.contents,
            match: [linkWithNoExtension],
          })
        ).toBeTruthy();
      },
      [DendronASTDest.MD_REGULAR]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        return [
          {
            actual: await AssertUtils.assertInString({
              body: resp.toString(),
              match: ["foo body"],
            }),
            expected: true,
          },
        ];
      },
      [DendronASTDest.HTML]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        return [
          {
            actual: await AssertUtils.assertInString({
              body: resp.toString(),
              match: ["foo body", "portal"],
            }),
            expected: true,
          },
        ];
      },
      [DendronASTDest.MD_ENHANCED_PREVIEW]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        return [
          {
            actual: await AssertUtils.assertInString({
              body: resp.toString(),
              match: ["foo body", "portal"],
            }),
            expected: true,
          },
        ];
      },
    },
    preSetupHook: ENGINE_HOOKS.setupBasic,
  });

  const RECURSIVE_TEST_CASES = createProcTests({
    name: "recursive",
    setupFunc: async ({ engine, extra, vaults }) => {
      const resp = await MDUtilsV4.procFull({
        engine,
        dest: extra.dest,
        vault: vaults[0],
      }).process(linkWithNoExtension);
      return { resp };
    },
    verifyFuncDict: {
      [DendronASTDest.MD_DENDRON]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        expect(
          await AssertUtils.assertInString({
            body: resp.contents,
            match: [linkWithNoExtension],
          })
        ).toBeTruthy();
      },
      [DendronASTDest.MD_REGULAR]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        return [
          {
            actual: await AssertUtils.assertInString({
              body: resp.toString(),
              match: ["# Foo", "# Foo.One", "# Foo.Two"],
            }),
            expected: true,
          },
        ];
      },
      [DendronASTDest.HTML]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        return [
          {
            actual: await AssertUtils.assertInString({
              body: resp.toString(),
              match: ["# Foo", "# Foo.One", "# Foo.Two", "portal"],
            }),
            expected: true,
          },
        ];
      },
      [DendronASTDest.MD_ENHANCED_PREVIEW]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        return [
          {
            actual: await AssertUtils.assertInString({
              body: resp.toString(),
              match: ["# Foo", "# Foo.One", "# Foo.Two", "portal"],
            }),
            expected: true,
          },
        ];
      },
    },
    preSetupHook: ENGINE_HOOKS.setupNoteRefRecursive,
  });

  const WILDCARD_CASE = createProcTests({
    name: "wildcard",
    setupFunc: async ({ engine, extra, vaults }) => {
      const note = engine.notes["id.journal"];
      // const resp = await proc(engine, {
      //   dest: extra.dest,
      //   vault: vaults[0],
      // }).process(note.body);
      const resp = await MDUtilsV4.procFull({
        engine,
        dest: extra.dest,
        vault: vaults[0],
      }).process(note.body);
      return { resp };
    },
    verifyFuncDict: {
      [DendronASTDest.MD_DENDRON]: async ({ extra, engine }) => {
        const note = engine.notes["id.journal"];
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        expect(
          await AssertUtils.assertInString({
            body: resp.contents,
            match: [note.body],
          })
        ).toBeTruthy();
      },
      [DendronASTDest.MD_REGULAR]: async ({ extra, engine }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
        // @ts-ignore
        return ENGINE_SERVER.NOTE_REF.WILDCARD_LINK_V4.genTestResults!({
          engine,
          extra: { body: resp.toString() },
        });
      },
      [DendronASTDest.HTML]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
      },
      [DendronASTDest.MD_ENHANCED_PREVIEW]: async ({ extra }) => {
        const { resp } = extra;
        expect(resp).toMatchSnapshot();
      },
    },
    preSetupHook: ENGINE_SERVER.NOTE_REF.WILDCARD_LINK_V4.preSetupHook,
  });

  const ALL_TEST_CASES = [
    ...REGULAR_CASE,
    ...RECURSIVE_TEST_CASES,
    ...WILDCARD_CASE,
  ];
  //const ALL_TEST_CASES = WILDCARD_CASE;
  describe("compile", () => {
    test.each(
      ALL_TEST_CASES.map((ent) => [`${ent.dest}: ${ent.name}`, ent.testCase])
    )("%p", async (_key, testCase: TestPresetEntryV4) => {
      await runEngineTestV4(testCase.testFunc, {
        expect,
        createEngine,
        preSetupHook: testCase.preSetupHook,
      });
    });
  });
});
