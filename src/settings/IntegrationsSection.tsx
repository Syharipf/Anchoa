import { GithubSection } from "./GithubSection";
import { EmailSection } from "./EmailSection";

export function IntegrationsSection({
  onChanged,
}: Readonly<{ onChanged: () => void }>) {
  return (
    <div className="flex flex-col gap-4">
      <GithubSection onChanged={onChanged} />
      <EmailSection onChanged={onChanged} />
    </div>
  );
}
