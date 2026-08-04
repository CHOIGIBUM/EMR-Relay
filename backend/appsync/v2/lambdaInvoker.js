import { util } from "@aws-appsync/utils";

export function request(ctx) {
  return {
    operation: "Invoke",
    payload: {
      field: ctx.info.fieldName,
      arguments: ctx.args,
      identity: ctx.identity,
      source: ctx.source,
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type, ctx.result);
  return ctx.result;
}
