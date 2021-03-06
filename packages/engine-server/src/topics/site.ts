import {
  DendronError,
  DendronSiteConfig,
  DendronSiteFM,
  DNodeUtilsV2,
  DVault,
  HierarchyConfig,
  NotePropsDictV2,
  NotePropsV2,
  NoteUtilsV2,
  VaultUtils,
} from "@dendronhq/common-all";
import _ from "lodash";
import { DConfig } from "../config";
import { DEngineClientV2 } from "../types";
import { stripLocalOnlyTags } from "../utils";
import fs from "fs-extra";
import path from "path";
import { vault2Path } from "@dendronhq/common-server";

export class SiteUtils {
  static canPublish(opts: { note: NotePropsV2; config: DendronSiteConfig }) {
    const { note, config } = opts;
    const hconfig = this.getConfigForHierarchy({ config, note });
    const domain = DNodeUtilsV2.domainName(note.fname);
    return _.every([
      config.siteHierarchies !== ["root"] &&
        config.siteHierarchies.indexOf(domain) >= 0,
      // not blacklisted
      note?.custom?.published !== false,
      // not whitelisted
      hconfig?.publishByDefault ? true : !note.custom?.published || false,
    ]);
  }

  static canPublishFiltered(opts: {
    note: NotePropsV2;
    config: HierarchyConfig;
  }) {
    const { note, config } = opts;
    return !_.some([
      // not blacklisted
      note?.custom?.published === false,
      // not whitelisted
      !config?.publishByDefault ? !note.custom?.published : false,
    ]);
  }

  static async copyAssets(opts: {
    wsRoot: string;
    vault: DVault;
    siteAssetsDir: string;
  }) {
    const { wsRoot, vault, siteAssetsDir } = opts;
    const vaultAssetsDir = path.join(vault2Path({ wsRoot, vault }), "assets");
    if (fs.existsSync(vaultAssetsDir)) {
      return fs.copy(path.join(vaultAssetsDir), path.join(siteAssetsDir));
    }
    return;
  }

  static addSiteOnlyNotes(opts: { engine: DEngineClientV2 }) {
    const { engine } = opts;
    const vaults = engine.vaultsv3;
    const note = NoteUtilsV2.create({
      vault: vaults[0],
      fname: "403",
      id: "403",
      title: "Access Denied",
      body: ["You are not allowed to view this page"].join("\n"),
    });
    return [note];
  }

  static async filterByConfig(opts: {
    engine: DEngineClientV2;
    config: DendronSiteConfig;
  }): Promise<{ notes: NotePropsDictV2; domains: NotePropsV2[] }> {
    const { engine, config } = opts;
    const { siteHierarchies } = config;
    let domains: NotePropsV2[] = [];
    // TODO: return domains from here
    const hiearchiesToPublish = await Promise.all(
      siteHierarchies.map(async (domain, idx) => {
        const out = await SiteUtils.filterByHiearchy({
          domain,
          config: DConfig.cleanSiteConfig(config),
          engine,
          navOrder: idx,
        });
        if (_.isUndefined(out)) {
          return {};
        }
        domains.push(out.domain);
        return out.notes;
      })
    );
    // if single hiearchy, domain includes all immediate children
    if (config.siteHierarchies.length === 1 && domains.length === 1) {
      const rootDomain = domains[0];
      domains = domains.concat(
        rootDomain.children.map((id) => engine.notes[id])
      );
    }

    return {
      notes: _.reduce(
        hiearchiesToPublish,
        (ent, acc) => {
          return _.merge(acc, ent);
        },
        {}
      ),
      domains,
    };
  }

  static async filterByHiearchy(opts: {
    domain: string;
    config: DendronSiteConfig;
    engine: DEngineClientV2;
    navOrder: number;
  }): Promise<{ notes: NotePropsDictV2; domain: NotePropsV2 } | undefined> {
    const { domain, engine, navOrder, config } = opts;

    // get config
    let rConfig: HierarchyConfig = _.defaults(
      _.get(config.config, "root", {
        publishByDefault: true,
        noindexByDefault: false,
        customFrontmatter: [],
      })
    );
    let hConfig: HierarchyConfig = _.defaults(
      _.get(config.config, domain),
      rConfig
    );
    // console.log(`hConfig for ${domain}`, hConfig); DEBUG
    const dupBehavior = config.duplicateNoteBehavior;
    // get the domain note
    let notes = NoteUtilsV2.getNotesByFname({
      fname: domain,
      notes: engine.notes,
    }).filter((note) =>
      SiteUtils.canPublishFiltered({ note, config: hConfig })
    );

    let domainNote: NotePropsV2;
    if (notes.length > 1) {
      if (dupBehavior) {
        const vault = dupBehavior.payload.vault;
        const maybeDomainNote = notes.filter((n) =>
          VaultUtils.isEqual(n.vault, vault, engine.wsRoot)
        );
        if (maybeDomainNote.length < 1) {
          // TODO: add warning
          return;
        }
        domainNote = maybeDomainNote[0];
      } else {
        throw new DendronError({ msg: `mult notes found for ${domain}` });
      }
    } else if (notes.length < 1) {
      // TODO: add warning
      return;
    } else {
      domainNote = { ...notes[0] };
    }
    if (!domainNote.custom) {
      domainNote.custom = {};
    }
    // set domain note settings
    domainNote.custom.nav_order = navOrder;
    domainNote.parent = null;
    domainNote.title = _.capitalize(domainNote.title);
    if (domainNote.fname === config.siteIndex) {
      domainNote.custom.permalink = "/";
    }

    const out: NotePropsDictV2 = {};
    const processQ = [domainNote];
    while (!_.isEmpty(processQ)) {
      const note = processQ.pop() as NotePropsV2;
      const maybeNote = SiteUtils.filterByNote({ note, hConfig });
      if (maybeNote) {
        if (config.writeStubs && maybeNote.stub) {
          maybeNote.stub = false;
          await engine.writeNote(note);
        }
        const siteFM = maybeNote.custom || ({} as DendronSiteFM);
        let children = maybeNote.children.map((id) => engine.notes[id]);
        if (siteFM.skipLevels) {
          let acc = 0;
          while (acc !== siteFM.skipLevels) {
            children = children.flatMap((ent) =>
              ent.children.map((id) => engine.notes[id])
            );
            acc += 1;
          }
          maybeNote.children = children.map((ent) => ent.id);
          children.forEach((ent) => (ent.parent = maybeNote.id));
        }
        children = _.filter(children, (note: NotePropsV2) =>
          SiteUtils.canPublishFiltered({ note, config: hConfig })
        );
        children.forEach((n: NotePropsV2) => processQ.push(n));
        // updated children
        out[maybeNote.id] = {
          ...maybeNote,
          children: children.map((ent) => ent.id),
        };
      }
    }
    return { notes: out, domain: domainNote };
  }

  static filterByNote(opts: {
    note: NotePropsV2;
    hConfig: HierarchyConfig;
  }): NotePropsV2 | undefined {
    const { note, hConfig } = opts;

    // apply custom frontmatter if exist
    hConfig.customFrontmatter?.forEach((fm) => {
      const { key, value } = fm;
      // @ts-ignore
      meta[key] = value;
    });
    if (hConfig.noindexByDefault && !_.has(note, "custom.noindex")) {
      _.set(note, "custom.noindex", true);
    }

    // remove site-only stuff
    return {
      ...note,
      body: stripLocalOnlyTags(note.body),
    };
  }

  static getConfigForHierarchy(opts: {
    config: DendronSiteConfig;
    note: NotePropsV2;
  }) {
    const { config, note } = opts;
    const domain = DNodeUtilsV2.domainName(note.fname);
    const siteConfig = config;
    // get config
    let rConfig: HierarchyConfig = _.defaults(
      _.get(siteConfig.config, "root", {
        publishByDefault: true,
        noindexByDefault: false,
        customFrontmatter: [],
      })
    );
    let hConfig: HierarchyConfig = _.defaults(
      _.get(siteConfig.config, domain),
      rConfig
    );
    return hConfig;
  }

  static getDomains(opts: {
    notes: NotePropsDictV2;
    config: DendronSiteConfig;
  }): NotePropsV2[] {
    const { notes, config } = opts;
    if (config.siteHierarchies.length === 1) {
      const fname = config.siteHierarchies[0];
      const rootNotes = NoteUtilsV2.getNotesByFname({ fname, notes });
      return [rootNotes[0]].concat(
        rootNotes[0].children.map((ent) => notes[ent])
      );
    } else {
      return _.filter(_.values(notes), { parent: null });
    }
  }
}
