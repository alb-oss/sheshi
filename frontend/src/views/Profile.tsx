import { Plus, ShieldCheck } from "lucide-react";
import { navigate } from "../appSupport";
import type { AuthState } from "../appSupport";
import { EmptyState } from "../components/overlays";

export function Profile(props: {
  auth: AuthState;
  canModerate: boolean;
  canCreateRooms: boolean;
  onAuth: () => void;
  onCreate: () => void;
  onLogout: () => void;
}) {
  if (!props.auth) return <EmptyState title="Nuk je hyre" action="HYR" onAction={props.onAuth} />;
  return (
    <section className="profile-card">
      <div className="avatar">{(props.auth.user.display_name || props.auth.user.username || "S").slice(0, 1).toUpperCase()}</div>
      <h1>{props.auth.user.display_name || props.auth.user.username}</h1>
      <p>{props.auth.user.email}</p>
      <div className="profile-roles" aria-label="Rolet">
        {props.auth.user.roles.map((role) => <span key={role}>{role}</span>)}
      </div>
      {(props.canModerate || props.canCreateRooms) && (
        <div className="profile-admin-actions">
          {props.canModerate && (
            <button className="primary-button" onClick={() => navigate("/moderim")}>
              <ShieldCheck size={16} /> MODERIM
            </button>
          )}
          {props.canCreateRooms && (
            <button className="ghost-button" onClick={props.onCreate}>
              <Plus size={16} /> KRIJO DHOME
            </button>
          )}
        </div>
      )}
      <button className="primary-button" onClick={props.onLogout}>DIL</button>
    </section>
  );
}
