import { IMail, Sender } from "../contracts/IMail";
import { ISenderScreeningResultProvider } from "../contracts/ISenderScreeningResultProvider";
import { IFolders, IFolderProvider, Folder } from "../contracts/IFolderProvider";
import { IMailbox } from "../contracts/IMailbox";
import { ScreeningResult } from "../contracts/ScreeningResult";
import { IDictionary } from "../contracts/IDictionary";

export interface IScreenerDeps {
  folders: IFolders
  senderScreeningProvider: ISenderScreeningResultProvider
  mailbox: IMailbox
}

interface ScreeningGuidelineChange {
  sender: Sender,
  newGuideline: ScreeningResult
}

export class Screener {
  constructor(private deps: IScreenerDeps) {

  }

  private screenInboxAsync = async (): Promise<void> => {
    const mails = await this.deps.mailbox.getMailAsync(this.deps.folders.Inbox)
    await Promise.all(mails.map(async mail => {
      const screeningResult = await this.deps.senderScreeningProvider.getScreeningResultAsync(mail.sender)
      switch (screeningResult) {
        case ScreeningResult.RequiresManualScreening:
          await this.deps.mailbox.moveMailAsync(mail.mailId, this.deps.folders.Inbox, this.deps.folders.ForScreening)
          break
        case ScreeningResult.Reference:
          await this.deps.mailbox.moveMailAsync(mail.mailId, this.deps.folders.Inbox, this.deps.folders.Reference)
          break
        case ScreeningResult.Newsletter:
          await this.deps.mailbox.moveMailAsync(mail.mailId, this.deps.folders.Inbox, this.deps.folders.Newsletter)
          break
        case ScreeningResult.Rejected:
          await this.deps.mailbox.moveMailAsync(mail.mailId, this.deps.folders.Inbox, this.deps.folders.Rejected)
          break
        default:
      }
    }))
  }

  private screenFolder = async (folder: Folder, correspondingScreeningResult: ScreeningResult): Promise<ScreeningGuidelineChange[]> => {
    const mails = await this.deps.mailbox.getMailAsync(folder)
    const changes: ScreeningGuidelineChange[] = []
    await Promise.all(mails.map(async mail => {
      const screeningResult = await this.deps.senderScreeningProvider.getScreeningResultAsync(mail.sender)
      if (screeningResult !== correspondingScreeningResult) {
        changes.push({
          sender: mail.sender,
          newGuideline: correspondingScreeningResult
        })
      }
    }))
    return changes
  }

  private getFolderForScreeningResult = (screeningResult: ScreeningResult): Folder => {
    switch (screeningResult) {
      case ScreeningResult.LeaveInInbox: return this.deps.folders.Inbox
      case ScreeningResult.Newsletter: return this.deps.folders.Newsletter
      case ScreeningResult.Reference: return this.deps.folders.Reference
      case ScreeningResult.Rejected: return this.deps.folders.Rejected
      case ScreeningResult.RequiresManualScreening:
      default:
        return this.deps.folders.ForScreening
    }
  }

  private moveMailsAsync = async (folder: Folder): Promise<void> => {
    const mails = await this.deps.mailbox.getMailAsync(folder)
    await Promise.all(mails.map(async mail => {
      const screeningResult = await this.deps.senderScreeningProvider.getScreeningResultAsync(mail.sender)
      const targetFolder = this.getFolderForScreeningResult(screeningResult)
      if (folder !== targetFolder) {
        await this.deps.mailbox.moveMailAsync(mail.mailId, folder, targetFolder)
      }
    }))
  }

  private applyGuidelineChanges = async (changes: ScreeningGuidelineChange[]) => {
    await Promise.all(changes.map(async change =>
      await this.deps.senderScreeningProvider.addScreeningGuidelineAsync(change.sender, change.newGuideline)
    ))
  }

  ScreenMailAsync = async (): Promise<void> => {
    const changes = ([] as ScreeningGuidelineChange[]).concat(
      await this.screenFolder(this.deps.folders.Newsletter, ScreeningResult.Newsletter),
      await this.screenFolder(this.deps.folders.Rejected, ScreeningResult.Rejected),
      await this.screenFolder(this.deps.folders.Reference, ScreeningResult.Reference),
      await this.screenFolder(this.deps.folders.Screened, ScreeningResult.LeaveInInbox),
    )

    await this.applyGuidelineChanges(changes)

    await this.moveMailsAsync(this.deps.folders.Inbox)
    await this.moveMailsAsync(this.deps.folders.Newsletter)
    await this.moveMailsAsync(this.deps.folders.Rejected)
    await this.moveMailsAsync(this.deps.folders.Reference)
    await this.moveMailsAsync(this.deps.folders.Screened)
  }
}