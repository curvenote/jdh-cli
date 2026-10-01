export type StepDisposition = 'run' | 'skip' | 'warn-skip';

export type RulesetId = 'jupytext';

/**
 * Artifact kinds a pipeline step reads or transforms.
 *
 * Steps declare which of these they touch so rulesets and tooling can reason
 * about prerequisites (e.g. bibtex steps need `references.bib` in the workdir).
 */
export type StepInputType =
  /** `article.md` body (GFM / MyST), including jupytext region comments. */
  | 'markdown'
  /** `article.ipynb` — citation-manager / Zotero metadata in notebook cells. */
  | 'ipynb'
  /** `references.bib` BibTeX bibliography. */
  | 'bibtex'
  /** `myst.yml` project config (legacy `curvenote.yml` fallback). */
  | 'myst'
  /**
   * Page-level YAML frontmatter in `article.md`, or jupytext `#region` blocks
   * tagged for metadata (title, contributor, keywords, abstract, etc.).
   */
  | 'frontmatter'
  /** Git remotes from the enclosing repository (`.git/config`). */
  | 'git'
  /**
   * Project-root assets copied or merged into the workdir (`meta-jdh.yml`,
   * `media/`, `plugins/`, etc.).
   */
  | 'project';

export interface ConvertOptions {
  dryRun: boolean;
  workdir: string;
  orcidLookup: boolean;
  rorLookup: boolean;
  rorMinScore: number;
  projectRoot?: string;
  /** Override for project.doi (otherwise looked up from the JDH API). */
  doi?: string;
  /** Override for the article URL, project.social.url (otherwise the JDH article page). */
  url?: string;
  /** Read Zotero items from the notebook's citation-manager data (default true). */
  zotero: boolean;
}

export interface RunContext {
  rulesetId: RulesetId;
  inputPath: string;
  inputAbs: string;
  projectRoot: string;
  workdir: string;
  workdirAbs: string;
  articleMd: string;
  articleIpynb: string;
  mystYml: string;
  options: ConvertOptions;
}

export interface PipelineStep {
  id: string;
  label: string;
  /** Artifact kinds this step reads or transforms (see {@link StepInputType}). */
  inputs: readonly StepInputType[];
  when?: (ctx: RunContext) => StepDisposition;
  run: (ctx: RunContext) => Promise<void>;
}

export interface Ruleset {
  id: RulesetId;
  label: string;
  steps: PipelineStep[];
}
