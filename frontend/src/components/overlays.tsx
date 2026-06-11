import { useState } from "react";
import type { ReactNode } from "react";
import { Copy, Link2, Mail, MessageCircle, Plus, Send, Share2 } from "lucide-react";
import { api, ApiError } from "../api";
import type { Room } from "../types";

export type ShareTarget = {
  title: string;
  text: string;
  url: string;
  roomName?: string | null;
};

export function Dialog(props: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onMouseDown={props.onClose}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <strong>{props.title}</strong>
          <button className="icon-button" onClick={props.onClose}>×</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function ShareDialog(props: { target: ShareTarget; onClose: () => void; onCopy: (target: ShareTarget) => void }) {
  const encodedUrl = encodeURIComponent(props.target.url);
  const encodedText = encodeURIComponent(props.target.text);
  const fullText = encodeURIComponent(`${props.target.text}\n${props.target.url}`);
  const shareOptions = [
    {
      label: "WhatsApp",
      icon: <MessageCircle size={17} />,
      href: `https://wa.me/?text=${fullText}`
    },
    {
      label: "Telegram",
      icon: <Send size={17} />,
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    },
    {
      label: "X",
      icon: <Share2 size={17} />,
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`
    },
    {
      label: "Facebook",
      icon: <Share2 size={17} />,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
    },
    {
      label: "Email",
      icon: <Mail size={17} />,
      href: `mailto:?subject=${encodeURIComponent(props.target.title)}&body=${fullText}`
    }
  ];

  return (
    <Dialog title="SHPERNDAJ" onClose={props.onClose}>
      <div className="share-sheet">
        <div className="share-preview">
          <span>{props.target.roomName || "SHESHI"}</span>
          <strong>{props.target.text || props.target.title}</strong>
          <small><Link2 size={13} /> {props.target.url}</small>
        </div>
        <div className="share-grid">
          {shareOptions.map((option) => (
            <a
              key={option.label}
              className="share-option"
              href={option.href}
              target="_blank"
              rel="noreferrer"
              onClick={props.onClose}
            >
              {option.icon}
              {option.label}
            </a>
          ))}
          <button className="share-option" type="button" onClick={() => props.onCopy(props.target)}>
            <Copy size={17} />
            Kopjo
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function EmptyState(props: { title: string; action?: string; onAction?: () => void | boolean }) {
  const { action, onAction } = props;
  return (
    <div className="empty-state">
      <h2>{props.title}</h2>
      {action && onAction && (
        <button className="primary-button" onClick={() => onAction()}>{action}</button>
      )}
    </div>
  );
}

export function LoadingRows() {
  return (
    <div className="loading-rows">
      <div />
      <div />
      <div />
    </div>
  );
}

export function CreateRoomDialog(props: { token: string; onClose: () => void; onCreated: (room: Room) => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function create() {
    try {
      props.onCreated(await api.createRoom({ token: props.token, input: { name, description } }));
    } catch (error) {
      props.onError(error instanceof ApiError ? error.message : "Dhoma nuk u krijua.");
    }
  }

  return (
    <Dialog title="KRIJO DHOME" onClose={props.onClose}>
      <div className="form-stack">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="#emri" />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Pershkrim i shkurter" />
        <button className="primary-button full" disabled={!name.trim()} onClick={create}><Plus size={16} /> KRIJO</button>
      </div>
    </Dialog>
  );
}
