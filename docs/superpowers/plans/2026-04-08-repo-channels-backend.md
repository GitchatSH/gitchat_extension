# Repo Channels — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram-style broadcast channel system where each GitHub repo gets an auto-provisioned channel. Admins (owner + contributors) can post; subscribers read + react. Content aggregated from X, YouTube, Gitstar community posts, and GitHub events.

**Architecture:** New `repo_channels` table (separate from `message_conversations`) with its own members table supporting roles (owner/admin/subscriber). Auto-provision via cron job that creates channels for all repos in DB and seeds members from contributors + tracked_repos + stargazers. WebSocket integration for realtime updates reusing existing `WebSocketEmitterService`.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, WebSocket (existing infra)

**Codebase:** `/Users/leebot/gitstar/backend/`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/database/postgres/entities/repo-channel.entity.ts` | Channel table: links to repo, stores metadata |
| Create | `src/database/postgres/entities/repo-channel-member.entity.ts` | Channel membership with roles |
| Create | `src/database/postgres/repositories/repo-channel.repository.ts` | Channel DB queries |
| Create | `src/database/postgres/repositories/repo-channel-member.repository.ts` | Member DB queries |
| Create | `src/database/postgres/migrations/TIMESTAMP-CreateRepoChannels.ts` | Migration for both tables |
| Modify | `src/database/postgres/index.ts` | Export new entities + repositories |
| Modify | `src/database/postgres/postgres.module.ts` | Register new entities + repositories |
| Create | `src/modules/repo-channels/repo-channels.module.ts` | NestJS module |
| Create | `src/modules/repo-channels/controllers/repo-channels.controller.ts` | REST API endpoints |
| Create | `src/modules/repo-channels/services/repo-channels.service.ts` | Business logic |
| Create | `src/modules/repo-channels/services/repo-channels-provision.service.ts` | Auto-provision + subscriber seeding |
| Create | `src/modules/repo-channels/dto/repo-channels.dto.ts` | Request/response DTOs |
| Create | `src/modules/repo-channels/repo-channels.errors.ts` | Error definitions |
| Modify | `src/websocket/constants/ws-namespaces.constant.ts` | Add channel WebSocket events |
| Modify | `src/modules/gitstar-posts/services/gitstar-posts.service.ts:~L50-60` | After creating post with repoTags, emit to channel |
| Modify | `src/modules/social/services/social-db.service.ts` | After caching social posts, emit to channel |
| Modify | `src/app.module.ts` | Import RepoChannelsModule |

---

### Task 1: Database Entities

**Files:**
- Create: `src/database/postgres/entities/repo-channel.entity.ts`
- Create: `src/database/postgres/entities/repo-channel-member.entity.ts`

- [ ] **Step 1: Create repo-channel entity**

```typescript
// src/database/postgres/entities/repo-channel.entity.ts
import { Entity, Column, Index, Unique } from 'typeorm';
import { AbstractEntity } from './abstract.entity';

@Entity('repo_channels')
@Unique('uq_repo_channels_owner_name', ['repoOwner', 'repoName'])
export class RepoChannelEntity extends AbstractEntity {
  @Column({ name: 'repo_owner', type: 'varchar' })
  @Index('idx_repo_channels_repo_owner')
  repoOwner: string;

  @Column({ name: 'repo_name', type: 'varchar' })
  @Index('idx_repo_channels_repo_name')
  repoName: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200, nullable: true })
  displayName: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'subscriber_count', type: 'int', default: 0 })
  subscriberCount: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'active' })
  status: string; // 'active' | 'archived'

  @Column({ name: 'provisioned_at', type: 'timestamptz', nullable: true })
  provisionedAt: Date | null;
}
```

- [ ] **Step 2: Create repo-channel-member entity**

```typescript
// src/database/postgres/entities/repo-channel-member.entity.ts
import { Entity, Column, Index, Unique } from 'typeorm';
import { AbstractEntityWithoutSoftDelete } from './abstract.entity';

@Entity('repo_channel_members')
@Unique('uq_repo_channel_members_active', ['channelId', 'userLogin']) // partial index added in migration
export class RepoChannelMemberEntity extends AbstractEntityWithoutSoftDelete {
  @Column({ name: 'channel_id', type: 'uuid' })
  @Index('idx_repo_channel_members_channel_id')
  channelId: string;

  @Column({ name: 'user_login', type: 'varchar' })
  @Index('idx_repo_channel_members_user_login')
  userLogin: string;

  @Column({ name: 'role', type: 'varchar', length: 20, default: 'subscriber' })
  role: string; // 'owner' | 'admin' | 'subscriber'

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'NOW()' })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date | null;

  @Column({ name: 'source', type: 'varchar', length: 30, nullable: true })
  source: string | null; // 'auto_owner' | 'auto_contributor' | 'auto_tracked' | 'auto_star' | 'manual' | 'star_action' | 'subscribe_action'
}
```

- [ ] **Step 3: Commit**

```bash
git add src/database/postgres/entities/repo-channel.entity.ts src/database/postgres/entities/repo-channel-member.entity.ts
git commit -m "feat(channels): add repo_channels and repo_channel_members entities"
```

---

### Task 2: Repositories

**Files:**
- Create: `src/database/postgres/repositories/repo-channel.repository.ts`
- Create: `src/database/postgres/repositories/repo-channel-member.repository.ts`

- [ ] **Step 1: Create channel repository**

```typescript
// src/database/postgres/repositories/repo-channel.repository.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AbstractRepository } from './abstract.repository';
import { RepoChannelEntity } from '../entities/repo-channel.entity';

@Injectable()
export class RepoChannelRepository extends AbstractRepository<RepoChannelEntity> {
  constructor(dataSource: DataSource) {
    super(RepoChannelEntity, dataSource);
  }
}
```

- [ ] **Step 2: Create member repository**

```typescript
// src/database/postgres/repositories/repo-channel-member.repository.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AbstractRepository } from './abstract.repository';
import { RepoChannelMemberEntity } from '../entities/repo-channel-member.entity';

@Injectable()
export class RepoChannelMemberRepository extends AbstractRepository<RepoChannelMemberEntity> {
  constructor(dataSource: DataSource) {
    super(RepoChannelMemberEntity, dataSource);
  }
}
```

- [ ] **Step 3: Register in postgres module**

Modify `src/database/postgres/index.ts` — add exports:
```typescript
export * from './entities/repo-channel.entity';
export * from './entities/repo-channel-member.entity';
export * from './repositories/repo-channel.repository';
export * from './repositories/repo-channel-member.repository';
```

Modify `src/database/postgres/postgres.module.ts` — add imports and register in entities array + providers array + exports array. Follow the existing pattern (look at how `UserTrackedRepoEntity` and `UserTrackedRepoRepository` are registered at lines ~30, ~99, ~169, ~240).

- [ ] **Step 4: Commit**

```bash
git add src/database/postgres/repositories/repo-channel.repository.ts src/database/postgres/repositories/repo-channel-member.repository.ts src/database/postgres/index.ts src/database/postgres/postgres.module.ts
git commit -m "feat(channels): add repo channel repositories and register in postgres module"
```

---

### Task 3: Database Migration

**Files:**
- Create: `src/database/postgres/migrations/1776500000000-CreateRepoChannels.ts`

- [ ] **Step 1: Create migration file**

```typescript
// src/database/postgres/migrations/1776500000000-CreateRepoChannels.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRepoChannels1776500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // repo_channels table
    await queryRunner.query(`
      CREATE TABLE repo_channels (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repo_owner VARCHAR NOT NULL,
        repo_name VARCHAR NOT NULL,
        display_name VARCHAR(200),
        description TEXT,
        avatar_url TEXT,
        subscriber_count INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        provisioned_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT uq_repo_channels_owner_name UNIQUE (repo_owner, repo_name)
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_repo_channels_repo_owner ON repo_channels (repo_owner);`);
    await queryRunner.query(`CREATE INDEX idx_repo_channels_repo_name ON repo_channels (repo_name);`);
    await queryRunner.query(`CREATE INDEX idx_repo_channels_status ON repo_channels (status);`);

    // repo_channel_members table
    await queryRunner.query(`
      CREATE TABLE repo_channel_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        channel_id UUID NOT NULL REFERENCES repo_channels(id) ON DELETE CASCADE,
        user_login VARCHAR NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'subscriber',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        source VARCHAR(30),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_repo_channel_members_channel_id ON repo_channel_members (channel_id);`);
    await queryRunner.query(`CREATE INDEX idx_repo_channel_members_user_login ON repo_channel_members (user_login);`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_repo_channel_members_active ON repo_channel_members (channel_id, user_login) WHERE left_at IS NULL;`);
    await queryRunner.query(`CREATE INDEX idx_repo_channel_members_role ON repo_channel_members (role) WHERE left_at IS NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS repo_channel_members;`);
    await queryRunner.query(`DROP TABLE IF EXISTS repo_channels;`);
  }
}
```

- [ ] **Step 2: Run migration to verify**

```bash
npm run typeorm migration:run
```

Expected: Migration applied successfully, both tables created.

- [ ] **Step 3: Commit**

```bash
git add src/database/postgres/migrations/1776500000000-CreateRepoChannels.ts
git commit -m "feat(channels): add migration for repo_channels and repo_channel_members tables"
```

---

### Task 4: Error Definitions + DTOs

**Files:**
- Create: `src/modules/repo-channels/repo-channels.errors.ts`
- Create: `src/modules/repo-channels/dto/repo-channels.dto.ts`

- [ ] **Step 1: Create error definitions**

```typescript
// src/modules/repo-channels/repo-channels.errors.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class RepoChannelErrors {
  static notFound() {
    return new HttpException('Channel not found', HttpStatus.NOT_FOUND);
  }
  static alreadySubscribed() {
    return new HttpException('Already subscribed to this channel', HttpStatus.CONFLICT);
  }
  static notSubscribed() {
    return new HttpException('Not subscribed to this channel', HttpStatus.BAD_REQUEST);
  }
  static notAdmin() {
    return new HttpException('Only channel admins can perform this action', HttpStatus.FORBIDDEN);
  }
  static cannotUnsubscribeOwner() {
    return new HttpException('Channel owner cannot unsubscribe', HttpStatus.BAD_REQUEST);
  }
}
```

- [ ] **Step 2: Create DTOs**

```typescript
// src/modules/repo-channels/dto/repo-channels.dto.ts
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListChannelsQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export class ChannelFeedQueryDto {
  @IsOptional() @IsString() source?: string; // 'x' | 'youtube' | 'gitstar' | 'github' | undefined (all)
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

export class AdminPostDto {
  @IsString() body: string;
  @IsOptional() @IsString({ each: true }) imageUrls?: string[];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/repo-channels/repo-channels.errors.ts src/modules/repo-channels/dto/repo-channels.dto.ts
git commit -m "feat(channels): add error definitions and DTOs"
```

---

### Task 5: Channel Service — Core Operations

**Files:**
- Create: `src/modules/repo-channels/services/repo-channels.service.ts`

- [ ] **Step 1: Create service with channel lookup + subscribe/unsubscribe**

```typescript
// src/modules/repo-channels/services/repo-channels.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { IsNull, In } from 'typeorm';
import { RepoChannelRepository } from '@database/postgres/repositories/repo-channel.repository';
import { RepoChannelMemberRepository } from '@database/postgres/repositories/repo-channel-member.repository';
import { RepoChannelEntity } from '@database/postgres/entities/repo-channel.entity';
import { RepoChannelMemberEntity } from '@database/postgres/entities/repo-channel-member.entity';
import { WebSocketEmitterService } from '@websocket/services/websocket-emitter.service';
import { RepoChannelErrors } from '../repo-channels.errors';

@Injectable()
export class RepoChannelsService {
  private readonly logger = new Logger(RepoChannelsService.name);

  constructor(
    private readonly channelRepo: RepoChannelRepository,
    private readonly memberRepo: RepoChannelMemberRepository,
    private readonly wsEmitter: WebSocketEmitterService,
  ) {}

  // ── Lookup ──────────────────────────────────────────────

  async getChannelByRepo(repoOwner: string, repoName: string): Promise<RepoChannelEntity | null> {
    return this.channelRepo.findOne({
      where: { repoOwner, repoName, status: 'active' },
    });
  }

  async getChannelById(channelId: string): Promise<RepoChannelEntity> {
    const ch = await this.channelRepo.findOne({ where: { id: channelId, status: 'active' } });
    if (!ch) { throw RepoChannelErrors.notFound(); }
    return ch;
  }

  // ── List user's subscribed channels ─────────────────────

  async listUserChannels(
    login: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ channels: any[]; nextCursor: string | null }> {
    const qb = this.memberRepo.createQueryBuilder('m')
      .innerJoin(RepoChannelEntity, 'c', 'c.id = m.channelId')
      .where('m.userLogin = :login', { login })
      .andWhere('m.leftAt IS NULL')
      .andWhere('c.status = :status', { status: 'active' })
      .select([
        'c.id AS id',
        'c.repo_owner AS repo_owner',
        'c.repo_name AS repo_name',
        'c.display_name AS display_name',
        'c.avatar_url AS avatar_url',
        'c.subscriber_count AS subscriber_count',
        'm.role AS role',
      ])
      .orderBy('c.subscriber_count', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere('c.subscriber_count < :cursor', { cursor: parseInt(cursor, 10) });
    }

    const rows = await qb.getRawMany();
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    return {
      channels: sliced.map(r => ({
        id: r.id,
        repoOwner: r.repo_owner,
        repoName: r.repo_name,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        subscriberCount: r.subscriber_count,
        role: r.role,
      })),
      nextCursor: hasMore ? String(sliced[sliced.length - 1].subscriber_count) : null,
    };
  }

  // ── Subscribe / Unsubscribe ─────────────────────────────

  async subscribe(channelId: string, login: string, source = 'manual'): Promise<void> {
    const channel = await this.getChannelById(channelId);

    // Check existing active membership
    const existing = await this.memberRepo.findOne({
      where: { channelId, userLogin: login, leftAt: IsNull() },
    });
    if (existing) { throw RepoChannelErrors.alreadySubscribed(); }

    // Check if previously left — rejoin
    const previousMember = await this.memberRepo.findOne({
      where: { channelId, userLogin: login },
      order: { createdAt: 'DESC' },
    });
    if (previousMember && previousMember.leftAt) {
      previousMember.leftAt = null;
      previousMember.joinedAt = new Date();
      previousMember.source = source;
      await this.memberRepo.save(previousMember);
    } else {
      await this.memberRepo.save(this.memberRepo.create({
        channelId,
        userLogin: login,
        role: 'subscriber',
        source,
      }));
    }

    // Update subscriber count
    await this.channelRepo.increment({ id: channelId }, 'subscriberCount', 1);

    // Emit realtime event
    this.wsEmitter.emit([{
      event_name: 'channel:subscriber_added',
      room: `channel:${channelId}`,
      timestamp: new Date().toISOString(),
      data: { channelId, login },
    }]).catch(err => this.logger.warn(`WS emit failed: ${err}`));
  }

  async unsubscribe(channelId: string, login: string): Promise<void> {
    const member = await this.memberRepo.findOne({
      where: { channelId, userLogin: login, leftAt: IsNull() },
    });
    if (!member) { throw RepoChannelErrors.notSubscribed(); }
    if (member.role === 'owner') { throw RepoChannelErrors.cannotUnsubscribeOwner(); }

    member.leftAt = new Date();
    await this.memberRepo.save(member);

    await this.channelRepo.decrement({ id: channelId }, 'subscriberCount', 1);

    this.wsEmitter.emit([{
      event_name: 'channel:subscriber_removed',
      room: `channel:${channelId}`,
      timestamp: new Date().toISOString(),
      data: { channelId, login },
    }]).catch(err => this.logger.warn(`WS emit failed: ${err}`));
  }

  // ── Role check helpers ──────────────────────────────────

  async isAdmin(channelId: string, login: string): Promise<boolean> {
    const member = await this.memberRepo.findOne({
      where: { channelId, userLogin: login, leftAt: IsNull() },
    });
    return !!member && (member.role === 'owner' || member.role === 'admin');
  }

  async getMembers(channelId: string, role?: string): Promise<RepoChannelMemberEntity[]> {
    const where: any = { channelId, leftAt: IsNull() };
    if (role) { where.role = role; }
    return this.memberRepo.find({ where, order: { joinedAt: 'ASC' } });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/repo-channels/services/repo-channels.service.ts
git commit -m "feat(channels): add core channel service with subscribe/unsubscribe and listing"
```

---

### Task 6: Channel Feed Service — Content Aggregation

**Files:**
- Modify: `src/modules/repo-channels/services/repo-channels.service.ts`

This task adds feed methods that query from multiple content sources (X, YouTube, Gitstar posts, GitHub events) and return them separately (matching the web UI tab layout).

- [ ] **Step 1: Add feed methods to service**

Append to `repo-channels.service.ts`:

```typescript
  // ── Channel Feed (per-source) ───────────────────────────

  async getChannelFeedX(
    repoOwner: string, repoName: string, cursor?: string, limit = 20,
  ): Promise<{ posts: any[]; nextCursor: string | null }> {
    // Query social_posts WHERE platform='x' AND repo_owner/repo_name match
    const qb = this.channelRepo.manager.createQueryBuilder()
      .select('sp')
      .from('social_posts', 'sp')
      .where('sp.platform = :platform', { platform: 'x' })
      .andWhere('sp.repo_owner = :repoOwner', { repoOwner })
      .andWhere('sp.repo_name = :repoName', { repoName })
      .orderBy('sp.platform_created_at', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere('sp.platform_created_at < :cursor', { cursor });
    }

    const rows = await qb.getRawMany();
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    return {
      posts: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].platform_created_at : null,
    };
  }

  async getChannelFeedYouTube(
    repoOwner: string, repoName: string, cursor?: string, limit = 20,
  ): Promise<{ posts: any[]; nextCursor: string | null }> {
    const qb = this.channelRepo.manager.createQueryBuilder()
      .select('sp')
      .from('social_posts', 'sp')
      .where('sp.platform = :platform', { platform: 'youtube' })
      .andWhere('sp.repo_owner = :repoOwner', { repoOwner })
      .andWhere('sp.repo_name = :repoName', { repoName })
      .orderBy('sp.platform_created_at', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere('sp.platform_created_at < :cursor', { cursor });
    }

    const rows = await qb.getRawMany();
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    return {
      posts: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].platform_created_at : null,
    };
  }

  async getChannelFeedGitstar(
    repoOwner: string, repoName: string, cursor?: string, limit = 20,
  ): Promise<{ posts: any[]; nextCursor: string | null }> {
    // Query gitstar_posts WHERE repoTags array contains 'owner/name'
    const repoSlug = `${repoOwner}/${repoName}`;
    const qb = this.channelRepo.manager.createQueryBuilder()
      .select('gp')
      .from('gitstar_posts', 'gp')
      .where('gp.deleted_at IS NULL')
      .andWhere('gp.visibility = :vis', { vis: 'public' })
      .andWhere(':slug = ANY(gp.repo_tags)', { slug: repoSlug })
      .orderBy('gp.created_at', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere('gp.created_at < :cursor', { cursor });
    }

    const rows = await qb.getRawMany();
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    return {
      posts: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].created_at : null,
    };
  }

  async getChannelFeedGitHub(
    repoOwner: string, repoName: string, cursor?: string, limit = 20,
  ): Promise<{ events: any[]; nextCursor: string | null }> {
    // Query following_events WHERE repoOwner/repoName match
    const qb = this.channelRepo.manager.createQueryBuilder()
      .select('fe')
      .from('following_events', 'fe')
      .where('fe.repo_owner = :repoOwner', { repoOwner })
      .andWhere('fe.repo_name = :repoName', { repoName })
      .andWhere('fe.is_complete = true')
      .orderBy('fe.event_created_at', 'DESC')
      .limit(limit + 1);

    if (cursor) {
      qb.andWhere('fe.event_created_at < :cursor', { cursor });
    }

    const rows = await qb.getRawMany();
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    return {
      events: sliced,
      nextCursor: hasMore ? sliced[sliced.length - 1].event_created_at : null,
    };
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/repo-channels/services/repo-channels.service.ts
git commit -m "feat(channels): add per-source feed methods (X, YouTube, Gitstar, GitHub events)"
```

---

### Task 7: Auto-Provision Service

**Files:**
- Create: `src/modules/repo-channels/services/repo-channels-provision.service.ts`

This cron job:
1. Finds all repos without a channel → creates channels
2. Seeds members: owner (role=owner), contributors (role=admin), tracked_repo users + stargazers (role=subscriber)

- [ ] **Step 1: Create provision service**

```typescript
// src/modules/repo-channels/services/repo-channels-provision.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsNull } from 'typeorm';
import { RepoChannelRepository } from '@database/postgres/repositories/repo-channel.repository';
import { RepoChannelMemberRepository } from '@database/postgres/repositories/repo-channel-member.repository';
import { RepoRepository } from '@database/postgres/repositories/repo.repository';
import { ContributorRepository } from '@database/postgres/repositories/contributor.repository';
import { UserTrackedRepoRepository } from '@database/postgres/repositories/user-tracked-repo.repository';
import { GitstarRepoStarRepository } from '@database/postgres/repositories/gitstar-repo-star.repository';

@Injectable()
export class RepoChannelsProvisionService {
  private readonly logger = new Logger(RepoChannelsProvisionService.name);
  private isRunning = false;

  constructor(
    private readonly channelRepo: RepoChannelRepository,
    private readonly memberRepo: RepoChannelMemberRepository,
    private readonly repoRepo: RepoRepository,
    private readonly contributorRepo: ContributorRepository,
    private readonly trackedRepoRepo: UserTrackedRepoRepository,
    private readonly repoStarRepo: GitstarRepoStarRepository,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async provisionChannels(): Promise<void> {
    if (this.isRunning) { return; }
    this.isRunning = true;
    try {
      await this.createMissingChannels();
      await this.seedMembers();
    } catch (err) {
      this.logger.error(`Provision failed: ${err}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async createMissingChannels(): Promise<void> {
    // Find repos that don't have a channel yet
    const repos = await this.repoRepo.manager.query(`
      SELECT r.owner, r.name, r.description, r.avatar_url
      FROM repos r
      LEFT JOIN repo_channels rc ON rc.repo_owner = r.owner AND rc.repo_name = r.name
      WHERE rc.id IS NULL
      LIMIT 500
    `);

    if (repos.length === 0) { return; }
    this.logger.log(`Creating ${repos.length} new channels`);

    for (const repo of repos) {
      await this.channelRepo.save(this.channelRepo.create({
        repoOwner: repo.owner,
        repoName: repo.name,
        displayName: `${repo.owner}/${repo.name}`,
        description: repo.description,
        avatarUrl: repo.avatar_url,
        provisionedAt: new Date(),
      }));
    }
  }

  private async seedMembers(): Promise<void> {
    // Get channels that were just provisioned (no members yet)
    const channels = await this.channelRepo.manager.query(`
      SELECT rc.id, rc.repo_owner, rc.repo_name
      FROM repo_channels rc
      WHERE rc.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM repo_channel_members rcm
        WHERE rcm.channel_id = rc.id AND rcm.left_at IS NULL
      )
      LIMIT 100
    `);

    for (const channel of channels) {
      const members: { login: string; role: string; source: string }[] = [];

      // 1. Repo owner → role=owner
      members.push({
        login: channel.repo_owner,
        role: 'owner',
        source: 'auto_owner',
      });

      // 2. Contributors → role=admin
      const contributors = await this.contributorRepo.find({
        where: { repoId: channel.id }, // Note: repoId might need to be looked up
        select: ['login'],
      });
      // Actually, contributors.repoId is the repo table ID, not channel ID.
      // Need to look up by repo owner/name via the repo table.
      const repoEntity = await this.repoRepo.findOne({
        where: { owner: channel.repo_owner, name: channel.repo_name },
      });
      if (repoEntity) {
        const contribs = await this.contributorRepo.find({
          where: { repoId: repoEntity.id, isBot: false },
          select: ['login'],
        });
        for (const c of contribs) {
          if (c.login !== channel.repo_owner) {
            members.push({ login: c.login, role: 'admin', source: 'auto_contributor' });
          }
        }
      }

      // 3. Tracked repo users → role=subscriber
      const trackers = await this.trackedRepoRepo.find({
        where: { repoOwner: channel.repo_owner, repoName: channel.repo_name },
        select: ['login'],
      });
      for (const t of trackers) {
        if (!members.find(m => m.login === t.login)) {
          members.push({ login: t.login, role: 'subscriber', source: 'auto_tracked' });
        }
      }

      // 4. Gitstar stargazers → role=subscriber
      const stars = await this.repoStarRepo.find({
        where: { repoOwner: channel.repo_owner, repoName: channel.repo_name, starred: true },
        select: ['userLogin'],
      });
      for (const s of stars) {
        if (!members.find(m => m.login === s.userLogin)) {
          members.push({ login: s.userLogin, role: 'subscriber', source: 'auto_star' });
        }
      }

      // Bulk insert members
      if (members.length > 0) {
        await this.memberRepo.save(
          members.map(m => this.memberRepo.create({
            channelId: channel.id,
            userLogin: m.login,
            role: m.role,
            source: m.source,
          })),
        );

        // Update subscriber count
        await this.channelRepo.update(channel.id, {
          subscriberCount: members.length,
        });

        this.logger.log(`Seeded ${members.length} members for ${channel.repo_owner}/${channel.repo_name}`);
      }
    }
  }

  // Called when a user stars a repo — add as subscriber
  async onRepoStarred(repoOwner: string, repoName: string, login: string): Promise<void> {
    const channel = await this.channelRepo.findOne({
      where: { repoOwner, repoName, status: 'active' },
    });
    if (!channel) { return; }

    const existing = await this.memberRepo.findOne({
      where: { channelId: channel.id, userLogin: login, leftAt: IsNull() },
    });
    if (existing) { return; }

    await this.memberRepo.save(this.memberRepo.create({
      channelId: channel.id,
      userLogin: login,
      role: 'subscriber',
      source: 'star_action',
    }));
    await this.channelRepo.increment({ id: channel.id }, 'subscriberCount', 1);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/repo-channels/services/repo-channels-provision.service.ts
git commit -m "feat(channels): add auto-provision cron and subscriber seeding service"
```

---

### Task 8: REST API Controller

**Files:**
- Create: `src/modules/repo-channels/controllers/repo-channels.controller.ts`

- [ ] **Step 1: Create controller**

```typescript
// src/modules/repo-channels/controllers/repo-channels.controller.ts
import { Controller, Get, Post, Delete, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@auth/guards/auth.guard'; // adjust import path to match existing auth guard
import { RepoChannelsService } from '../services/repo-channels.service';
import { ListChannelsQueryDto, ChannelFeedQueryDto } from '../dto/repo-channels.dto';

@Controller('channels')
@UseGuards(AuthGuard)
export class RepoChannelsController {
  constructor(private readonly channelsService: RepoChannelsService) {}

  // GET /channels — list user's subscribed channels
  @Get()
  async listMyChannels(@Req() req: any, @Query() query: ListChannelsQueryDto) {
    const login = req.user.login;
    return this.channelsService.listUserChannels(login, query.cursor, query.limit);
  }

  // GET /channels/repo/:owner/:name — get channel by repo
  @Get('repo/:owner/:name')
  async getChannelByRepo(@Param('owner') owner: string, @Param('name') name: string) {
    const channel = await this.channelsService.getChannelByRepo(owner, name);
    if (!channel) { return { channel: null }; }
    return { channel };
  }

  // GET /channels/:id — get channel details
  @Get(':id')
  async getChannel(@Param('id') id: string) {
    const channel = await this.channelsService.getChannelById(id);
    return { channel };
  }

  // GET /channels/:id/members — get channel members
  @Get(':id/members')
  async getMembers(@Param('id') id: string, @Query('role') role?: string) {
    const members = await this.channelsService.getMembers(id, role);
    return { members };
  }

  // POST /channels/:id/subscribe — subscribe to channel
  @Post(':id/subscribe')
  async subscribe(@Param('id') id: string, @Req() req: any) {
    await this.channelsService.subscribe(id, req.user.login, 'subscribe_action');
    return { success: true };
  }

  // DELETE /channels/:id/subscribe — unsubscribe from channel
  @Delete(':id/subscribe')
  async unsubscribe(@Param('id') id: string, @Req() req: any) {
    await this.channelsService.unsubscribe(id, req.user.login);
    return { success: true };
  }

  // ── Feed endpoints (per-source, matching web UI tabs) ───

  // GET /channels/:id/feed/x — X/Twitter posts
  @Get(':id/feed/x')
  async feedX(@Param('id') id: string, @Query() query: ChannelFeedQueryDto) {
    const channel = await this.channelsService.getChannelById(id);
    return this.channelsService.getChannelFeedX(
      channel.repoOwner, channel.repoName, query.cursor, query.limit,
    );
  }

  // GET /channels/:id/feed/youtube — YouTube posts
  @Get(':id/feed/youtube')
  async feedYouTube(@Param('id') id: string, @Query() query: ChannelFeedQueryDto) {
    const channel = await this.channelsService.getChannelById(id);
    return this.channelsService.getChannelFeedYouTube(
      channel.repoOwner, channel.repoName, query.cursor, query.limit,
    );
  }

  // GET /channels/:id/feed/gitstar — Gitstar community posts
  @Get(':id/feed/gitstar')
  async feedGitstar(@Param('id') id: string, @Query() query: ChannelFeedQueryDto) {
    const channel = await this.channelsService.getChannelById(id);
    return this.channelsService.getChannelFeedGitstar(
      channel.repoOwner, channel.repoName, query.cursor, query.limit,
    );
  }

  // GET /channels/:id/feed/github — GitHub events (releases, PRs, etc.)
  @Get(':id/feed/github')
  async feedGitHub(@Param('id') id: string, @Query() query: ChannelFeedQueryDto) {
    const channel = await this.channelsService.getChannelById(id);
    return this.channelsService.getChannelFeedGitHub(
      channel.repoOwner, channel.repoName, query.cursor, query.limit,
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/repo-channels/controllers/repo-channels.controller.ts
git commit -m "feat(channels): add REST API controller with feed and subscription endpoints"
```

---

### Task 9: NestJS Module + App Registration

**Files:**
- Create: `src/modules/repo-channels/repo-channels.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create module**

```typescript
// src/modules/repo-channels/repo-channels.module.ts
import { Module } from '@nestjs/common';
import { RepoChannelsController } from './controllers/repo-channels.controller';
import { RepoChannelsService } from './services/repo-channels.service';
import { RepoChannelsProvisionService } from './services/repo-channels-provision.service';
import { PostgresModule } from '@database/postgres/postgres.module';
import { WebSocketModule } from '@websocket/websocket.module'; // adjust to match existing import

@Module({
  imports: [PostgresModule, WebSocketModule],
  controllers: [RepoChannelsController],
  providers: [RepoChannelsService, RepoChannelsProvisionService],
  exports: [RepoChannelsService, RepoChannelsProvisionService],
})
export class RepoChannelsModule {}
```

- [ ] **Step 2: Register in app.module.ts**

Add `RepoChannelsModule` to the `imports` array in `src/app.module.ts`. Follow existing pattern of other module imports.

- [ ] **Step 3: Verify compilation**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/repo-channels/repo-channels.module.ts src/app.module.ts
git commit -m "feat(channels): register repo channels module in app"
```

---

### Task 10: WebSocket Events

**Files:**
- Modify: `src/websocket/constants/ws-namespaces.constant.ts`

- [ ] **Step 1: Add channel events to WebSocket constants**

Add to the existing events object (find the pattern in the file):

```typescript
// Channel events
CHANNEL_POST: 'channel:post',
CHANNEL_SUBSCRIBER_ADDED: 'channel:subscriber_added',
CHANNEL_SUBSCRIBER_REMOVED: 'channel:subscriber_removed',
CHANNEL_UPDATED: 'channel:updated',
```

Room prefix pattern: `channel:{channelId}` (used in service emit calls).

- [ ] **Step 2: Commit**

```bash
git add src/websocket/constants/ws-namespaces.constant.ts
git commit -m "feat(channels): add channel WebSocket event constants"
```

---

### Task 11: Integration Hooks — Auto-publish to Channel

**Files:**
- Modify: `src/modules/gitstar-posts/services/gitstar-posts.service.ts`
- Modify: `src/modules/social/services/social-db.service.ts` (or equivalent X/YouTube caching service)

- [ ] **Step 1: Emit channel event when Gitstar community post is created with repoTags**

In `gitstar-posts.service.ts`, after a post is successfully created (find the `createPost` method, around line 50-100), add:

```typescript
// After post is saved successfully:
if (post.repoTags && post.repoTags.length > 0) {
  for (const repoSlug of post.repoTags) {
    const [repoOwner, repoName] = repoSlug.split('/');
    if (repoOwner && repoName) {
      const channel = await this.repoChannelRepo.findOne({
        where: { repoOwner, repoName, status: 'active' },
      });
      if (channel) {
        this.wsEmitter.emit([{
          event_name: 'channel:post',
          room: `channel:${channel.id}`,
          timestamp: new Date().toISOString(),
          data: { channelId: channel.id, source: 'gitstar', post },
        }]).catch(err => this.logger.warn(`Channel WS emit failed: ${err}`));
      }
    }
  }
}
```

Inject `RepoChannelRepository` into the service constructor.

- [ ] **Step 2: Emit channel event when social posts (X/YouTube) are cached for a repo**

In the social post caching service, after new posts are saved for a repo:

```typescript
// After social posts saved:
if (repoOwner && repoName) {
  const channel = await this.repoChannelRepo.findOne({
    where: { repoOwner, repoName, status: 'active' },
  });
  if (channel) {
    this.wsEmitter.emit([{
      event_name: 'channel:post',
      room: `channel:${channel.id}`,
      timestamp: new Date().toISOString(),
      data: { channelId: channel.id, source: platform, count: savedPosts.length },
    }]).catch(err => this.logger.warn(`Channel WS emit failed: ${err}`));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/gitstar-posts/services/gitstar-posts.service.ts src/modules/social/services/social-db.service.ts
git commit -m "feat(channels): emit realtime events when content is published to repo channels"
```

---

### Task 12: Hook Star/Subscribe Actions to Channel Membership

**Files:**
- Modify: Service that handles `gitstar_repo_stars` creation (find via grep for `GitstarRepoStarRepository` usage)

- [ ] **Step 1: After user stars a repo, add as channel subscriber**

Find the service method that handles starring (likely in a repos service or stars service). After the star record is created:

```typescript
// After star is saved:
await this.repoChannelsProvisionService.onRepoStarred(repoOwner, repoName, login);
```

Inject `RepoChannelsProvisionService` into the service.

- [ ] **Step 2: Verify and commit**

```bash
npm run build
git add -A
git commit -m "feat(channels): auto-subscribe users on star action"
```

---

## API Endpoints Summary

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/channels` | List my subscribed channels | Required |
| GET | `/channels/repo/:owner/:name` | Get channel by repo | Required |
| GET | `/channels/:id` | Get channel details | Required |
| GET | `/channels/:id/members` | Get channel members | Required |
| POST | `/channels/:id/subscribe` | Subscribe to channel | Required |
| DELETE | `/channels/:id/subscribe` | Unsubscribe from channel | Required |
| GET | `/channels/:id/feed/x` | X/Twitter feed | Required |
| GET | `/channels/:id/feed/youtube` | YouTube feed | Required |
| GET | `/channels/:id/feed/gitstar` | Gitstar community posts | Required |
| GET | `/channels/:id/feed/github` | GitHub events feed | Required |

## Telegram Concepts Mapped

| Telegram | Gitstar Channel |
|----------|----------------|
| Channel owner | `role='owner'` (repo owner) |
| Channel admin with `can_post_messages` | `role='admin'` (contributors) |
| Subscriber (read-only) | `role='subscriber'` |
| `sender_chat` (posts show as channel) | Posts show as channel, admin name in metadata |
| Linked discussion group | Existing group chat per repo (future integration) |
