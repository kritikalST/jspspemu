﻿///<reference path="../../typings.d.ts" />

import memory = require('../memory');
import state = require('./state');
import ast = require('./ast');
import ast_builder = require('./ast_builder');
import instructions = require('./instructions');

import InstructionAst = ast.InstructionAst;
import Memory = memory.Memory;
import Instructions = instructions.Instructions;
import Instruction = instructions.Instruction;
import DecodedInstruction = instructions.DecodedInstruction;
import CpuState = state.CpuState;
import MipsAstBuilder = ast_builder.MipsAstBuilder;

export interface InstructionUsage {
	name: string;
	count: number;
}

export class FunctionGenerator {
	private instructions: Instructions = Instructions.instance;
	private instructionAst = new InstructionAst();
	private instructionUsageCount: StringDictionary<number> = {};

	getInstructionUsageCount(): InstructionUsage[] {
		var items: InstructionUsage[] = [];
		for (var key in this.instructionUsageCount) {
			var value = this.instructionUsageCount[key];
			items.push({ name: key, count: value });
		}
		items.sort((a, b) => compareNumbers(a.count, b.count)).reverse();
		return items;
	}

	constructor(public memory: Memory) {
	}

	private decodeInstruction(address: number) {
		var instruction = Instruction.fromMemoryAndPC(this.memory, address);
		var instructionType = this.getInstructionType(instruction);
		return new DecodedInstruction(instruction, instructionType);
	}

	private getInstructionType(i: Instruction) {
		return this.instructions.findByData(i.data, i.PC);
	}

	private generateInstructionAstNode(di: DecodedInstruction): ast_builder.ANodeStm {
		var instruction = di.instruction;
		var instructionType = di.type;
		var func: Function = this.instructionAst[instructionType.name];
		if (func === undefined) throw (sprintf("Not implemented '%s' at 0x%08X", instructionType, di.instruction.PC));
		return func.call(this.instructionAst, instruction);
	}

	create(address: number) {
		if (address == 0x00000000) {
			throw (new Error("Trying to execute 0x00000000"));
		}

		var ast = new MipsAstBuilder();

		var PC = address;
		var stms: ast_builder.ANodeStm[] = [ast.functionPrefix()];

		var emitInstruction = () => {
			var result = this.generateInstructionAstNode(this.decodeInstruction(PC))
            PC += 4;
			return result;
		};

		for (var n = 0; n < 100000; n++) {
			var di = this.decodeInstruction(PC + 0);
			//console.log(di);

			if (this.instructionUsageCount[di.type.name] === undefined) {
				this.instructionUsageCount[di.type.name] = 0;
				//console.warn('NEW instruction: ', di.type.name);
			}
			this.instructionUsageCount[di.type.name]++;

			//if ([0x089162F8, 0x08916318].contains(PC)) stms.push(ast.debugger(sprintf('PC: %08X', PC)));

			if (di.type.hasDelayedBranch) {
				var di2 = this.decodeInstruction(PC + 4);

				stms.push(emitInstruction());

				var delayedSlotInstruction = emitInstruction();
				if (di2.type.isSyscall) {
					stms.push(this.instructionAst._postBranch(PC));
					stms.push(this.instructionAst._likely(di.type.isLikely, delayedSlotInstruction));
				}
				else {
					stms.push(this.instructionAst._likely(di.type.isLikely, delayedSlotInstruction));
					stms.push(this.instructionAst._postBranch(PC));
				}

				break;
			} else {
				if (di.type.isSyscall) {
					stms.push(this.instructionAst._storePC(PC + 4));
				}
				stms.push(emitInstruction());
				if (di.type.isBreak) {
					stms.push(this.instructionAst._storePC(PC));

					break;
				}
			}
		}

		//console.debug(sprintf("// function_%08X:\n%s", address, ast.stms(stms).toJs()));

		if (n >= 100000) throw (new Error(sprintf("Too large function PC=%08X", address)));

		return new Function('state', ast.stms(stms).toJs());
	}
}
