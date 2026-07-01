import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  PriceFactSchema,
  ServiceMetaListSchema,
  type PriceFact,
} from "../src/lib/schema.ts";

const RAW_DIR = path.resolve("data/raw");
const SERVICES_FILE = path.resolve("data/services.yml");

interface FileError {
  file: string;
  messages: string[];
}

function fail(errors: FileError[]): never {
  console.error(`\n❌ 데이터 검증 실패 — ${errors.length}개 파일에 문제가 있어요\n`);
  for (const { file, messages } of errors) {
    console.error(`  ${file}`);
    for (const m of messages) console.error(`    - ${m}`);
  }
  console.error("");
  process.exit(1);
}

function main() {
  const errors: FileError[] = [];

  // 1) 서비스 카탈로그 검증
  const servicesRaw = parse(readFileSync(SERVICES_FILE, "utf-8"));
  const servicesResult = ServiceMetaListSchema.safeParse(servicesRaw);
  if (!servicesResult.success) {
    errors.push({
      file: "data/services.yml",
      messages: servicesResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    fail(errors); // 카탈로그가 깨지면 이후 검증이 의미 없으니 바로 중단
  }
  const knownServiceIds = new Set(servicesResult.data.map((s) => s.id));

  // 2) 가격 파일들 검증
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  if (files.length === 0) {
    console.error("❌ data/raw/ 에 yml 파일이 하나도 없어요");
    process.exit(1);
  }

  const seenKeys = new Map<string, string>(); // "service:country" -> 처음 본 파일명
  const parsed: { file: string; fact: PriceFact }[] = [];

  for (const file of files) {
    const fullPath = path.join(RAW_DIR, file);
    const messages: string[] = [];

    let raw: unknown;
    try {
      raw = parse(readFileSync(fullPath, "utf-8"));
    } catch (e) {
      errors.push({ file, messages: [`YAML 파싱 실패: ${(e as Error).message}`] });
      continue;
    }

    const result = PriceFactSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        messages.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
      errors.push({ file, messages });
      continue;
    }

    const fact = result.data;

    // 카탈로그에 없는 서비스를 참조하는지
    if (!knownServiceIds.has(fact.service)) {
      messages.push(
        `service "${fact.service}"가 data/services.yml에 없어요. 카탈로그에 먼저 추가하세요.`,
      );
    }

    // 파일명이 {service}-{country}.yml 컨벤션을 따르는지 (소문자 country)
    const expectedName = `${fact.service}-${fact.country.toLowerCase()}.yml`;
    if (file !== expectedName) {
      messages.push(`파일명은 "${expectedName}"이어야 해요 (현재: ${file})`);
    }

    // service+country 중복 체크
    const key = `${fact.service}:${fact.country}`;
    const seenIn = seenKeys.get(key);
    if (seenIn) {
      messages.push(`"${fact.service}"의 "${fact.country}" 가격이 ${seenIn}와 중복돼요`);
    } else {
      seenKeys.set(key, file);
    }

    // 같은 파일 안에서 plan id 중복 체크
    const planIds = fact.plans.map((p) => p.id);
    const dupPlanIds = planIds.filter((id, i) => planIds.indexOf(id) !== i);
    if (dupPlanIds.length > 0) {
      messages.push(`중복된 plan id: ${[...new Set(dupPlanIds)].join(", ")}`);
    }

    if (messages.length > 0) {
      errors.push({ file, messages });
    } else {
      parsed.push({ file, fact });
    }
  }

  if (errors.length > 0) fail(errors);

  console.log(`✅ 데이터 검증 통과 — 서비스 ${knownServiceIds.size}개, 가격 파일 ${parsed.length}개`);
}

main();
