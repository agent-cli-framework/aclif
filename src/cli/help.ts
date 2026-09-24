// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {type Command, CommandHelp, Help, type Interfaces} from '@oclif/core'

import {renderBin} from '../core/output/render-bin.js'

/**
 * oclif help with the $BIN token rendered.
 *
 * Command descriptions and examples are authored with $BIN (see
 * render-bin.ts). The base command renders it on every line it logs, but
 * oclif draws help itself and never calls log(), so without this class
 * `--help` shows the token as written. Both formatters oclif uses (the
 * root and topic listings, and a single command's page) get the same
 * render step, after oclif's own template rendering.
 */
class AclifCommandHelp extends CommandHelp {
  constructor(command: Command.Loadable, config: Interfaces.Config, opts: Interfaces.HelpOptions) {
    super(command, config, opts)
    const render = this.render
    this.render = (input: string) => renderBin(render(input), config.bin)
  }
}

export default class AclifHelp extends Help {
  protected CommandHelpClass: typeof CommandHelp = AclifCommandHelp

  constructor(config: Interfaces.Config, opts: Partial<Interfaces.HelpOptions> = {}) {
    super(config, opts)
    const render = this.render
    this.render = (input: string) => renderBin(render(input), config.bin)
  }
}
