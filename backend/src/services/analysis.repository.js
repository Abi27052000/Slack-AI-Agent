import prisma from '../lib/prisma.js';

/** Statuses of an analysis that is queued or running. */
export const IN_FLIGHT_STATUSES = ['PENDING', 'RESEARCHING', 'ANALYZING'];

/**
 * An analysis that should stop a new one from starting:
 *  - a successful (non-fallback) one inside the cooldown window, or
 *  - one still in flight (e.g. team_join and member_joined_channel arriving seconds apart).
 * Failed and fallback analyses never block, so they get retried on the next join.
 */
export function findBlockingAnalysis(memberId, { cooldownSince, inFlightSince }) {
  return prisma.memberAnalysis.findFirst({
    where: {
      memberId,
      OR: [
        { status: { in: ['ANALYZED', 'POSTED'] }, isFallback: false, createdAt: { gte: cooldownSince } },
        { status: { in: IN_FLIGHT_STATUSES }, createdAt: { gte: inFlightSince } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, createdAt: true },
  });
}

export function createPendingAnalysis({ memberId, trigger, triggerChannelId = null }) {
  return prisma.memberAnalysis.create({
    data: { memberId, trigger, triggerChannelId, status: 'PENDING' },
    select: { id: true },
  });
}

export function updateAnalysis(id, data) {
  return prisma.memberAnalysis.update({ where: { id }, data });
}

export function getAnalysisWithMember(id) {
  return prisma.memberAnalysis.findUnique({ where: { id }, include: { member: true } });
}

/** Analyses left queued/running by a previous process (crash, deploy, restart). */
export function findInterruptedAnalyses() {
  return prisma.memberAnalysis.findMany({
    where: { status: { in: IN_FLIGHT_STATUSES } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}
