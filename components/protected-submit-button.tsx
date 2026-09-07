"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type ProtectedSubmitButtonProps = {
  children: string;
  className?: string;
  confirmationMessage?: string;
  form?: string;
  formAction?: string;
  style?: React.CSSProperties;
  promptOnSubmitOnly?: boolean;
};

export function ProtectedSubmitButton({
  children,
  className,
  confirmationMessage,
  form,
  formAction,
  style,
  promptOnSubmitOnly = true
}: ProtectedSubmitButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalPassword, setModalPassword] = useState("");
  const initialFormValuesRef = useRef<Map<string, string | boolean>>(new Map());

  // Capture initial snapshot of form fields
  const snapshotForm = useCallback((form: HTMLFormElement) => {
    const map = new Map<string, string | boolean>();
    const elements = Array.from(form.elements) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    elements.forEach((el, index) => {
      const key = el.name || `el_${index}`;
      if (el.name === "operationPassword") return;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        map.set(key, el.checked);
      } else {
        map.set(key, el.value);
      }
    });
    initialFormValuesRef.current = map;
  }, []);

  // Check if form is dirty compared to snapshot
  const checkDirty = useCallback((form: HTMLFormElement) => {
    const elements = Array.from(form.elements) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    let dirty = false;
    for (let index = 0; index < elements.length; index++) {
      const el = elements[index];
      if (el.name === "operationPassword") continue;
      const key = el.name || `el_${index}`;
      const initialVal = initialFormValuesRef.current.get(key);
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        if (initialVal !== undefined && initialVal !== el.checked) {
          dirty = true;
          break;
        }
      } else {
        if (initialVal !== undefined && initialVal !== el.value) {
          dirty = true;
          break;
        }
      }
    }
    setIsDirty(dirty);
  }, []);

  const handleCancel = useCallback(() => {
    const form = buttonRef.current?.form;
    if (!form) return;
    form.reset();
    const passwordInput = form.querySelector<HTMLInputElement>('input[name="operationPassword"]');
    if (passwordInput) {
      passwordInput.value = "";
      setPasswordValue("");
      setHasPassword(false);
    }
    setTimeout(() => {
      snapshotForm(form);
      setIsDirty(false);
    }, 50);
  }, [snapshotForm]);

  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) {
      setHasPassword(true);
      return;
    }

    const passwordInput = form.querySelector<HTMLInputElement>('input[name="operationPassword"]');
    snapshotForm(form);

    function updatePasswordState() {
      const val = passwordInput?.value || "";
      setPasswordValue(val);
      setHasPassword(Boolean(val.trim()));
    }

    function handleFormChange() {
      checkDirty(form!);
    }

    updatePasswordState();
    if (passwordInput) {
      passwordInput.addEventListener("input", updatePasswordState);
    }

    form.addEventListener("input", handleFormChange);
    form.addEventListener("change", handleFormChange);

    return () => {
      if (passwordInput) {
        passwordInput.removeEventListener("input", updatePasswordState);
      }
      form.removeEventListener("input", handleFormChange);
      form.removeEventListener("change", handleFormChange);
    };
  }, [snapshotForm, checkDirty]);

  const handlePasswordChangeInDock = (val: string) => {
    setPasswordValue(val);
    setHasPassword(Boolean(val.trim()));
    const form = buttonRef.current?.form;
    const passwordInput = form?.querySelector<HTMLInputElement>('input[name="operationPassword"]');
    if (passwordInput) {
      passwordInput.value = val;
    }
  };

  const submitWithPassword = (pwd: string) => {
    const form = buttonRef.current?.form;
    if (!form) return;

    let passwordInput = form.querySelector<HTMLInputElement>('input[name="operationPassword"]');
    if (!passwordInput) {
      passwordInput = document.createElement("input");
      passwordInput.type = "hidden";
      passwordInput.name = "operationPassword";
      form.appendChild(passwordInput);
    }
    passwordInput.value = pwd;
    setShowModal(false);
    setModalPassword("");
    setPasswordValue(pwd);
    setHasPassword(true);

    setTimeout(() => {
      buttonRef.current?.click();
    }, 50);
  };

  const handleSaveClick = (event: React.MouseEvent) => {
    // If password is already set, allow submit
    if (hasPassword || passwordValue.trim()) {
      if (confirmationMessage && !window.confirm(confirmationMessage)) {
        event.preventDefault();
      }
      return;
    }

    // Prompt on submit flow
    event.preventDefault();
    if (confirmationMessage && !window.confirm(confirmationMessage)) {
      return;
    }
    setShowModal(true);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="submit"
        form={form}
        formAction={formAction}
        className={className}
        style={style}
        onClick={handleSaveClick}
      >
        {children}
      </button>

      {/* Modal Popup on Submit */}
      {showModal && (
        <>
          <div className="unsaved-backdrop-lock" onClick={() => setShowModal(false)} />
          <div className="unsaved-changes-dock" style={{ zIndex: 10000 }}>
            <div className="unsaved-changes-info">
              <span className="unsaved-icon">🔐</span>
              <div>
                <strong>Operation Password Required</strong>
                <p>Enter Admin / Dispatch Password to proceed: <strong>{children}</strong></p>
              </div>
            </div>

            <div className="unsaved-changes-actions">
              <input
                type="password"
                className="unsaved-password-input"
                placeholder="Enter password..."
                value={modalPassword}
                onChange={(e) => setModalPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (modalPassword.trim()) {
                      submitWithPassword(modalPassword.trim());
                    }
                  }
                }}
                autoFocus
              />
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button"
                disabled={!modalPassword.trim()}
                onClick={() => {
                  if (modalPassword.trim()) {
                    submitWithPassword(modalPassword.trim());
                  }
                }}
              >
                {children}
              </button>
            </div>
          </div>
        </>
      )}


    </>
  );
}
