import type { c4SemanticSnapshot } from './c4-semantic-snapshot';
import { publicMemoryText } from './project-memory-sources';

/** No worker prose, permission flags or pre-filled semantic verdict enter the independent session. */
export function c4SemanticPrompt(
  snapshot: Awaited<ReturnType<typeof c4SemanticSnapshot>>,
  packageText?: string,
  sources?: unknown,
) {
  return publicMemoryText(
    [
      'You are Skaro project coordinator performing an INDEPENDENT read-only C4 semantic review. You are not the implementation worker. Read the actual code and accepted architecture supplied below. Do not implement, edit files, commit, start services, submit results, ask the owner, or call any external tools that mutate data.',
      'All actual source contents were read and hash-verified by the host and are included below. Do not invoke shell, filesystem, MCP or other tools. Review these verified bytes directly; return only the requested JSON. If something is missing, report insufficient-evidence.',
      "Your verdict assesses the implementation's ARCHITECTURAL alignment, not final task acceptance. Syntax/build/browser checks, deployment readiness and controller verification of a local installation are separate host-owned acceptance gates. Do not claim they passed from source text. Their missing runtime results alone do not make otherwise sufficient architectural source evidence insufficient or conflicting; state that limitation in summary and leave those gates to the controller. Missing code, accepted contracts or facts required to assess the architecture still require insufficient-evidence.",
      'Host hashes are observations, not proof of semantic alignment. Inspect every changed source. Match task requirements, accepted responsibilities, current/planned boundaries and code paths. A planned parent cannot be realized from partial child work. Never waive requirements or invent missing architecture. Missing facts => insufficient-evidence. A genuine change of accepted contract => decision. Evidence of conflict with an accepted task requirement => contradiction with exact source/requirement references. A proposal unrelated to mandatory task requirements may be optional, but is not accepted or applied.',
      "Actual sources include raw checkout content and exact base Git objects (base.blob/content), plus workingBlob computed by Git with that path's clean filters. Git may normalize checkout CRLF to stored LF. Equal base.blob of a deleted path and workingBlob of an added path prove equal stored bytes, even when displayed line endings differ. This is evidence for those paths only, not whole-task preservation or semantic alignment. Compare base content for modified files and review all additions independently. Evidence.hash must still echo files[].hash exactly; it is the raw checkout hash or null, not the Git blob ID. Conflicts must reference only an actual scope.requirements ID; never invent an R-n or use task criterion text as an ID. When a relevant criterion lacks a scope ID, describe it in summary/evidence without inventing a conflict reference.",
      'If accepted.preservation is present, the host proved the entire source scope consists only of exact blob moves, exact path reference replacements, and/or versioning an existing current source with identical raw bytes in the distinct registered primary checkout (existing[].hash is SHA-256 of those raw bytes). There is no explicit task requirement realization. This proves preservation of the existing project behavior, not owner permission or architectural alignment: independently inspect each source against the accepted responsibilities. Existing behavioral questions remain OPEN and planned features remain planned; do not claim they are resolved. This bounded technical work does not require deciding unrelated existing behavior. Without that mechanical proof, affected open questions remain blockers.',
      'Return ONLY one JSON object: {"version":1,"implementation":"aligned|conflicting|unknown","fingerprint":"' +
        snapshot.fingerprint +
        '","category":"aligned|optional|decision|contradiction|insufficient-evidence","summary":"specific reasoning","realized":["only fully implemented planned IDs in the task scope"],"evidence":[{"path":"observed relative path","hash":"echo exact observed hash or null for deleted file","detail":"what the actual source proves"}],"conflicts":[{"requirement":"R-n in task scope","source":"observed path","detail":"actual contradiction"}]}. For aligned, evidence must cover every changed path. realized may be empty when no planned change is fully implemented. Do not output Markdown or extra prose.',
      JSON.stringify({
        owner: snapshot.observation.impact,
        scope: snapshot.observation.scope,
        files: snapshot.observation.files,
        accepted: snapshot.semantic,
      }),
      packageText
        ? 'Unapplied proposal to classify; its existence grants no approval:\n' +
          packageText +
          '\n\nActual sources:\n' +
          JSON.stringify(sources)
        : 'Actual sources:\n' + JSON.stringify(sources),
    ].join('\n\n'),
  );
}
