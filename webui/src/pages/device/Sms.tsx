import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Input,
  Layout,
  Modal,
  Progress,
  Space,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { IconDelete, IconPlus, IconRefresh, IconSearch, IconSend } from '@douyinfe/semi-icons';
import { ubus } from '@/services/deviceUbus';
import { decodeDeliver, mergeParts, readableTime, type InboxMessage } from '@/modules/sms/decode';
import { TAG_COLOR } from '@/ui/tokens';

const { Sider, Content } = Layout;

type Inbox = { ok?: boolean; used?: number; capacity?: number; indexes?: number[]; limited?: boolean };
type ReadResult = { ok?: boolean; pdu?: string };
type Thread = { number: string; messages: InboxMessage[] };

const avatarLabel = (num: string) => {
  const digits = num.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2);
  return num.slice(0, 2) || '?';
};

const Sms: React.FC = () => {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [active, setActive] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const summary = await ubus<Inbox>('dlink-cellular', 'sms_list');
      setInbox(summary);
      const decoded: InboxMessage[] = [];
      let bad = 0;
      for (const index of (summary.indexes || []).slice(0, 80)) {
        try {
          const message = await ubus<ReadResult>('dlink-cellular', 'sms_read', { index });
          const parsed = message.pdu ? decodeDeliver(message.pdu) : null;
          if (parsed) decoded.push({ index, ...parsed });
          else bad += 1;
        } catch {
          bad += 1;
        }
      }
      setMessages(mergeParts(decoded));
      setUnreadable(bad);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '读取短信失败');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, InboxMessage[]>();
    messages.forEach((message) => {
      const key = message.number || '未知号码';
      map.set(key, [...(map.get(key) || []), message]);
    });
    const list = Array.from(map.entries())
      .map(([number, items]) => ({ number, messages: items }))
      .sort((a, b) => b.messages[b.messages.length - 1].index - a.messages[a.messages.length - 1].index);

    const keyword = query.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(
      (thread) =>
        thread.number.toLowerCase().includes(keyword) ||
        thread.messages.some((m) => (m.content || '').toLowerCase().includes(keyword)),
    );
  }, [messages, query]);

  const current = threads.find((thread) => thread.number === active) || threads[0];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [current?.messages.length, active]);

  const send = async (to: string, body: string) => {
    if (!to.trim() || !body.trim()) {
      Toast.warning('号码和内容都要填');
      return false;
    }
    setSending(true);
    try {
      await ubus('dlink-cellular', 'sms_send', { to: to.trim(), body, confirm: true });
      Toast.success('已发送');
      return true;
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '发送失败');
      return false;
    } finally {
      setSending(false);
    }
  };

  const storagePct = inbox?.capacity ? Math.round(((inbox.used || 0) / inbox.capacity) * 100) : 0;

  const removeOne = async (index: number) => {
    try {
      await ubus('dlink-cellular', 'sms_delete', { index, confirm: true });
      Toast.success('已删除');
      await load();
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const removeThread = async (thread: Thread) => {
    let removed = 0;
    let failed = 0;
    for (const message of thread.messages) {
      try {
        await ubus('dlink-cellular', 'sms_delete', { index: message.index, confirm: true });
        removed += 1;
      } catch {
        failed += 1;
      }
    }
    if (removed && !failed) Toast.success(`已删除 ${removed} 条`);
    else if (removed) Toast.warning(`已删除 ${removed} 条，${failed} 条失败`);
    else Toast.error('删除失败');
    if (thread.number === active) setActive('');
    await load();
  };

  return (
    <div className="sms-page">
      <div className="sms-toolbar">
        <div className="sms-toolbar-main">
          {inbox?.capacity ? (
            <div className="sms-storage-pill">
              <span>SIM 存储</span>
              <b>
                {inbox.used ?? 0}/{inbox.capacity}
              </b>
              <Progress percent={storagePct} showInfo={false} size="small" />
            </div>
          ) : (
            <span className="toolbar-pill">共 {threads.length} 组会话</span>
          )}
        </div>
        <div className="sms-toolbar-actions">
          <Button size="small" icon={<IconRefresh />} loading={refreshing} onClick={() => load()}>
            刷新
          </Button>
          <Button size="small" theme="solid" type="primary" icon={<IconPlus />} onClick={() => setComposeOpen(true)}>
            发送新短信
          </Button>
        </div>
      </div>

      {inbox?.limited ? (
        <Banner type="warning" closeIcon={null} description="短信条数超过模块一次上报的上限，当前仅列出前一部分。" />
      ) : null}
      {unreadable ? (
        <Banner
          type="info"
          closeIcon={null}
          description={`${unreadable} 条短信不是纯文本（可能是运营商通知或二进制推送），未在会话中展示。`}
        />
      ) : null}

      <Layout className="sms-shell">
        <Sider className="sms-contacts">
          <div className="sms-contacts-head">
            <Input
              prefix={<IconSearch />}
              size="small"
              value={query}
              onChange={setQuery}
              placeholder="搜索号码或内容…"
              showClear
            />
          </div>
          {threads.length === 0 ? (
            <div className="sms-contact-empty">
              <Typography.Text type="tertiary">
                {refreshing ? '正在同步短信…' : query ? '没有匹配的短信' : '暂无短信会话'}
              </Typography.Text>
            </div>
          ) : (
            <div className="sms-contact-list">
              {threads.map((thread) => {
                const last = thread.messages[thread.messages.length - 1];
                const isSelected = current?.number === thread.number;
                return (
                  <div
                    key={thread.number}
                    className={`sms-contact${isSelected ? ' active' : ''}`}
                    onClick={() => setActive(thread.number)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => event.key === 'Enter' && setActive(thread.number)}
                  >
                    <span className="sms-avatar" aria-hidden="true">
                      {avatarLabel(thread.number)}
                    </span>
                    <div className="sms-contact-main">
                      <div className="sms-contact-line">
                        <span className="sms-contact-name">{thread.number}</span>
                        <span className="sms-contact-time">{readableTime(last.time).slice(5, 16)}</span>
                      </div>
                      <div className="sms-contact-bottom">
                        <span className="sms-contact-preview">{last.content || '(空内容)'}</span>
                        {thread.messages.length > 1 ? (
                          <span className="sms-count-pill">{thread.messages.length}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Sider>

        <Content className="sms-thread">
          {current ? (
            <>
              <div className="sms-thread-head">
                <div className="sms-thread-peer">
                  <span className="sms-avatar sms-avatar--sm" aria-hidden="true">
                    {avatarLabel(current.number)}
                  </span>
                  <div>
                    <div className="sms-thread-title">{current.number}</div>
                    <div className="sms-thread-sub">共 {current.messages.length} 条记录</div>
                  </div>
                </div>
                <Space spacing={8}>
                  <Tag size="small" color={TAG_COLOR.neutral}>
                    SIM 收件箱
                  </Tag>
                  {import.meta.env.VITE_SMS_DELETE !== 'off' && (<Button
                    size="small"
                    type="danger"
                    theme="borderless"
                    icon={<IconDelete />}
                    onClick={() => {
                      Modal.confirm({
                        title: '删除整段会话',
                        content: `将删除与 ${current.number} 的全部 ${current.messages.length} 条短信，删除后无法恢复。`,
                        okText: '删除',
                        okButtonProps: { type: 'danger', theme: 'solid' },
                        cancelText: '取消',
                        onOk: () => removeThread(current),
                      });
                    }}
                  >
                    删除会话
                  </Button>)}
                </Space>
              </div>

              <div className="sms-messages">
                {current.messages.map((message) => (
                  <div className="sms-message-row" key={message.index}>
                    <div className="sms-message-body">
                      <span className="sms-message-time">
                        {readableTime(message.time)}
                        {message.parts ? ` · 分片 ${message.parts.seq}/${message.parts.total}` : ''}
                      </span>
                      <div className="sms-bubble">{message.content || '(无内容)'}</div>
                    </div>
                    {import.meta.env.VITE_SMS_DELETE !== 'off' && (<Button
                      className="sms-message-delete"
                      size="small"
                      type="danger"
                      theme="borderless"
                      icon={<IconDelete />}
                      aria-label="删除这条短信"
                      onClick={() => {
                        Modal.confirm({
                          title: '删除这条短信',
                          content: '删除后无法恢复。',
                          okText: '删除',
                          okButtonProps: { type: 'danger', theme: 'solid' },
                          cancelText: '取消',
                          onOk: () => removeOne(message.index),
                        });
                      }}
                    />)}
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              <div className="sms-composer">
                <TextArea
                  value={draft}
                  onChange={setDraft}
                  placeholder={`回复 ${current.number}…`}
                  autosize={{ minRows: 2, maxRows: 4 }}
                />
                <Button
                  theme="solid"
                  type="primary"
                  icon={<IconSend />}
                  loading={sending}
                  onClick={async () => {
                    if (await send(current.number, draft)) {
                      setDraft('');
                      await load();
                    }
                  }}
                >
                  发送
                </Button>
              </div>
              <div className="sms-composer-hint">
                <span>当前 {draft.length} 字 · 超过 70 个汉字将由模组自动拆分成长短信</span>
              </div>
            </>
          ) : (
            <div className="sms-thread-empty">
              <Typography.Text type="tertiary">选择左侧号码查看对话，或点击右上角发送新短信</Typography.Text>
            </div>
          )}
        </Content>
      </Layout>

      <Modal
        title="发送新短信"
        visible={composeOpen}
        footer={null}
        width={440}
        onCancel={() => {
          setComposeOpen(false);
          setComposeTo('');
          setComposeBody('');
        }}
      >
        <Space vertical spacing={14} className="sms-compose-form">
          <Input placeholder="请输入接收号码" value={composeTo} onChange={(value) => setComposeTo(value)} />
          <TextArea
            value={composeBody}
            onChange={setComposeBody}
            placeholder="请输入短信内容"
            autosize={{ minRows: 3, maxRows: 6 }}
          />
          <Button
            theme="solid"
            type="primary"
            block
            icon={<IconSend />}
            loading={sending}
            onClick={async () => {
              if (await send(composeTo, composeBody)) {
                setComposeOpen(false);
                setComposeTo('');
                setComposeBody('');
                await load();
              }
            }}
          >
            立即发送
          </Button>
        </Space>
      </Modal>
    </div>
  );
};

export default Sms;
