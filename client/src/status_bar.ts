// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.

import { DenoExtensionContext } from "./types";

import * as vscode from "vscode";

export class DenoStatusBar {
  readonly #inner: vscode.StatusBarItem;

  constructor() {
    this.#inner = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      0,
    );
    this.#inner.command = "deno.openOutput";
  }

  dispose() {
    this.#inner.dispose();
  }

  refresh(extensionContext: DenoExtensionContext) {
    if (extensionContext.serverInfo) {
      this.#inner.text = `Deno ${extensionContext.serverInfo.version}`;
      this.#inner.tooltip = extensionContext.serverInfo.versionWithBuildInfo;
    }

    // show only when "enable" is true and language server started
    if (
      ((extensionContext.workspaceSettings.enable ??
        extensionContext.hasDenoConfig) ||
        extensionContext.enabledPaths.length !== 0) &&
      extensionContext.client &&
      extensionContext.serverInfo
    ) {
      this.#inner.show();
    } else {
      this.#inner.hide();
    }
  }
}
